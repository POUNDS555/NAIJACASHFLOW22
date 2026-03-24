const fs = require('fs');
const matter = require('gray-matter');
const path = require('path');

// Get the post file path from command line arguments
const postFile = process.argv[2];
if (!postFile) {
  console.error('No file specified');
  process.exit(1);
}

// Read and parse the file
const fileContent = fs.readFileSync(postFile, 'utf8');
const { data, content } = matter(fileContent);

// Extract metadata with sensible defaults
const title = data.title || 'Untitled';
const description = data.description || data.excerpt || content.slice(0, 200).replace(/\n/g, ' ').trim();
const image = data.image || data.thumbnail || 'https://naijacashflow.com/images/default-og.jpg';

// Build the post URL
let url;

// Case 1: Jekyll date-based posts in _posts folder: _posts/YYYY-MM-DD-slug.md
const datePostMatch = postFile.match(/_posts\/(\d{4})-(\d{2})-(\d{2})-(.+)\.md$/);
if (datePostMatch) {
  const [, year, month, day, slug] = datePostMatch;
  url = `https://naijacashflow.com/${year}/${month}/${day}/${slug}/`;
} else {
  // Case 2: Any markdown file outside _posts: use filename as slug
  const filename = path.basename(postFile, '.md');             // get file name without extension
  const slug = filename.toLowerCase().replace(/ /g, '-');     // convert to slug
  url = `https://naijacashflow.com/${slug}/`;
}

// Output JSON for the workflow
console.log(JSON.stringify({
  title,
  description: description.slice(0, 280),
  image,
  url,
}));
