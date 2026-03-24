const fs = require('fs');
const matter = require('gray-matter');

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
const image = data.image || data.thumbnail || 'https://NaijaCashFlow.com/images/default-og.jpg'; // 👈 change default image

// Build the post URL – adjust to match your site's URL structure
// Example for Jekyll with date in filename: YYYY-MM-DD-slug.md
const match = postFile.match(/(\d{4})-(\d{2})-(\d{2})-(.+)\.md$/);
let url;
if (match) {
  const [, year, month, day, slug] = match;
  url = `https://NaijaCashFlow.com/${year}/${month}/${day}/${slug}/`;  // 👈 change domain
} else {
  // Fallback: use the filename without extension and convert to slug
  const slug = postFile.replace(/^.*[\\/]/, '').replace(/\.md$/, '').toLowerCase().replace(/ /g, '-');
  url = `https://NaijaCashFlow.com/${slug}/`;  // 👈 change domain
}

// Output JSON for the workflow
console.log(JSON.stringify({
  title,
  description: description.slice(0, 280),
  image,
  url,
}));
