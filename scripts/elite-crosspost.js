const axios = require('axios');
const { TwitterApi } = require('twitter-api-v2');
const FormData = require('form-data');

// ---------- Logger ----------
function log(level, message, meta = {}) {
  const timestamp = new Date().toISOString();
  console.log(JSON.stringify({ timestamp, level, message, ...meta }));
}

// ---------- Retry Helper ----------
async function retry(fn, maxRetries = 3, delayMs = 1000) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      log('warn', `Attempt ${attempt} failed`, { error: error.message });
      if (attempt === maxRetries) throw error;
      await new Promise(resolve => setTimeout(resolve, delayMs * Math.pow(2, attempt - 1)));
    }
  }
}

// ---------- Environment Validation ----------
function validateEnv() {
  const required = {
    POST_URL: process.env.POST_URL,
    POST_TITLE: process.env.POST_TITLE,
    POST_DESCRIPTION: process.env.POST_DESCRIPTION,
    POST_IMAGE: process.env.POST_IMAGE,
  };
  const missing = Object.entries(required).filter(([_, v]) => !v).map(([k]) => k);
  if (missing.length) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
}

// ---------- Pinterest (with image URL) ----------
async function postToPinterest(title, description, imageUrl, link) {
  const token = process.env.PINTEREST_ACCESS_TOKEN;
  const boardId = process.env.PINTEREST_BOARD_ID;
  if (!token || !boardId) return log('warn', 'Pinterest credentials missing, skipping');

  const payload = {
    board_id: boardId,
    title: title.slice(0, 100),
    description: description.slice(0, 500),
    media_source: { source_type: 'image_url', url: imageUrl },
    link: link,
  };

  await retry(async () => {
    const response = await axios.post('https://api.pinterest.com/v5/pins', payload, {
      headers: { Authorization: `Bearer ${token}` },
    });
    log('info', 'Pinterest posted', { pinId: response.data.id });
  });
}

// ---------- Twitter (using twitter-api-v2) ----------
async function postToTwitter(text, link) {
  const apiKey = process.env.TWITTER_API_KEY;
  const apiSecret = process.env.TWITTER_API_SECRET;
  const accessToken = process.env.TWITTER_ACCESS_TOKEN;
  const accessSecret = process.env.TWITTER_ACCESS_SECRET;

  if (!apiKey || !apiSecret || !accessToken || !accessSecret) {
    return log('warn', 'Twitter credentials missing, skipping');
  }

  const client = new TwitterApi({
    appKey: apiKey,
    appSecret: apiSecret,
    accessToken: accessToken,
    accessSecret: accessSecret,
  });

  const tweetText = `${text}\n\n${link}`.slice(0, 280);

  await retry(async () => {
    const tweet = await client.v2.tweet(tweetText);
    log('info', 'Twitter posted', { tweetId: tweet.data.id });
  });
}

// ---------- Facebook Page (with image upload) ----------
async function postToFacebook(message, link, imageUrl) {
  const accessToken = process.env.FACEBOOK_PAGE_ACCESS_TOKEN;
  const pageId = process.env.FACEBOOK_PAGE_ID;
  if (!accessToken || !pageId) return log('warn', 'Facebook credentials missing, skipping');

  let mediaId = null;
  try {
    const imageResponse = await axios.get(imageUrl, { responseType: 'arraybuffer' });
    const buffer = Buffer.from(imageResponse.data, 'binary');
    const form = new FormData();
    form.append('source', buffer, { filename: 'image.jpg' });
    form.append('published', 'false');

    const uploadUrl = `https://graph.facebook.com/v19.0/${pageId}/photos`;
    const uploadRes = await axios.post(uploadUrl, form, {
      headers: { ...form.getHeaders(), Authorization: `Bearer ${accessToken}` },
      params: { access_token: accessToken },
    });
    mediaId = uploadRes.data.id;
    log('info', 'Facebook image uploaded', { mediaId });
  } catch (error) {
    log('warn', 'Failed to upload image to Facebook, posting link only', { error: error.message });
  }

  const payload = {
    message: `${message}\n\n${link}`,
    ...(mediaId && { attached_media: [{ media_fbid: mediaId }] }),
  };

  await retry(async () => {
    const response = await axios.post(`https://graph.facebook.com/v19.0/${pageId}/feed`, payload, {
      params: { access_token: accessToken },
    });
    log('info', 'Facebook posted', { postId: response.data.id });
  });
}

// ---------- Main Orchestrator ----------
(async () => {
  try {
    validateEnv();

    const url = process.env.POST_URL;
    const title = process.env.POST_TITLE;
    const description = process.env.POST_DESCRIPTION;
    const image = process.env.POST_IMAGE;

    log('info', 'Starting crosspost', { title, url });

    // Run all posts in parallel with delays to avoid rate limits
    const tasks = [
      postToPinterest(title, description, image, url),
      new Promise(resolve => setTimeout(resolve, 1000)).then(() => postToTwitter(description, url)),
      new Promise(resolve => setTimeout(resolve, 2000)).then(() => postToFacebook(title, url, image)),
    ];

    await Promise.allSettled(tasks);

    log('info', 'Crosspost completed');
  } catch (error) {
    log('error', 'Fatal error', { error: error.message });
    process.exit(1);
  }
})();
