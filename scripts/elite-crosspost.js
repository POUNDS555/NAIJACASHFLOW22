const axios = require('axios');
const { TwitterApi } = require('twitter-api-v2');
const FormData = require('form-data');

/**
 * ---------- Logger ----------
 * Structured logging for better debugging in GitHub Actions
 */
function log(level, message, meta = {}) {
  const timestamp = new Date().toISOString();
  console.log(JSON.stringify({ timestamp, level, message, ...meta }));
}

/**
 * ---------- Retry Helper ----------
 * Exponential backoff to handle transient API issues
 */
async function retry(fn, maxRetries = 3, delayMs = 1000) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      const errorMessage = error.response?.data ? JSON.stringify(error.response.data) : error.message;
      log('warn', `Attempt ${attempt} failed`, { error: errorMessage });
      if (attempt === maxRetries) throw error;
      await new Promise(resolve => setTimeout(resolve, delayMs * Math.pow(2, attempt - 1)));
    }
  }
}

/**
 * ---------- Environment Validation ----------
 */
function validateEnv() {
  const url = process.env.POST_URL;
  const title = process.env.POST_TITLE;

  // Check if critical data is missing or passed as the literal string "undefined"
  if (!url || url === 'undefined' || !title || title === 'undefined') {
    throw new Error(`Missing critical metadata. URL: ${url}, Title: ${title}`);
  }
}

/**
 * ---------- Pinterest ----------
 */
async function postToPinterest(title, description, imageUrl, link) {
  const token = process.env.PINTEREST_ACCESS_TOKEN;
  const boardId = process.env.PINTEREST_BOARD_ID;
  
  if (!token || !boardId) return log('warn', 'Pinterest credentials missing, skipping');
  if (!imageUrl || imageUrl === 'undefined') return log('warn', 'Pinterest requires an image, skipping');

  const payload = {
    board_id: boardId,
    title: (title || "New Post").slice(0, 100),
    description: (description || title || "").slice(0, 500),
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

/**
 * ---------- Twitter (X) ----------
 */
async function postToTwitter(title, description, link) {
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

  // Use description if available, otherwise title
  const content = description && description !== 'undefined' ? description : title;
  const tweetText = `${content}\n\n${link}`.slice(0, 280);

  await retry(async () => {
    const tweet = await client.v2.tweet(tweetText);
    log('info', 'Twitter posted', { tweetId: tweet.data.id });
  });
}

/**
 * ---------- Facebook Page ----------
 */
async function postToFacebook(title, link, imageUrl) {
  const accessToken = process.env.FACEBOOK_PAGE_ACCESS_TOKEN;
  const pageId = process.env.FACEBOOK_PAGE_ID;
  
  if (!accessToken || !pageId) return log('warn', 'Facebook credentials missing, skipping');

  let mediaId = null;

  // Attempt image upload only if image exists
  if (imageUrl && imageUrl !== 'undefined') {
    try {
      const imageResponse = await axios.get(imageUrl, { responseType: 'arraybuffer' });
      const buffer = Buffer.from(imageResponse.data, 'binary');
      const form = new FormData();
      form.append('source', buffer, { filename: 'image.jpg' });
      form.append('published', 'false');

      const uploadUrl = `https://graph.facebook.com/v19.0/${pageId}/photos`;
      const uploadRes = await axios.post(uploadUrl, form, {
        headers: { ...form.getHeaders() },
        params: { access_token: accessToken },
      });
      mediaId = uploadRes.data.id;
      log('info', 'Facebook image uploaded', { mediaId });
    } catch (error) {
      log('warn', 'Facebook image upload failed, falling back to link-only', { error: error.message });
    }
  }

  const payload = {
    message: `${title}\n\n${link}`,
    ...(mediaId && { attached_media: [{ media_fbid: mediaId }] }),
  };

  await retry(async () => {
    const response = await axios.post(`https://graph.facebook.com/v19.0/${pageId}/feed`, payload, {
      params: { access_token: accessToken },
    });
    log('info', 'Facebook posted', { postId: response.data.id });
  });
}

/**
 * ---------- Main Orchestrator ----------
 */
(async () => {
  try {
    validateEnv();

    const url = process.env.POST_URL;
    const title = process.env.POST_TITLE;
    const description = process.env.POST_DESCRIPTION;
    const image = process.env.POST_IMAGE;

    log('info', 'Starting crosspost execution', { title, url });

    // Execute all platforms. Promise.allSettled ensures one failure doesn't stop the others.
    const tasks = [
      postToPinterest(title, description, image, url),
      new Promise(resolve => setTimeout(resolve, 1500)).then(() => postToTwitter(title, description, url)),
      new Promise(resolve => setTimeout(resolve, 3000)).then(() => postToFacebook(title, url, image)),
    ];

    const results = await Promise.allSettled(tasks);
    
    // Check if everything failed or if we had partial success
    const failedTasks = results.filter(r => r.status === 'rejected');
    if (failedTasks.length === tasks.length) {
        log('error', 'All posting tasks failed');
        process.exit(1);
    }

    log('info', 'Crossposting process finished');
  } catch (error) {
    log('error', 'Fatal script error', { error: error.message });
    process.exit(1);
  }
})();
