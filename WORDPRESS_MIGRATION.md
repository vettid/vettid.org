# WordPress to Static Site Migration Guide

This guide will help you export your WordPress site (vettid.org) to static HTML files for hosting on AWS.

## Why Go Static?

- **Faster**: No PHP/database queries, just static files served via CDN
- **More Secure**: No WordPress vulnerabilities to exploit
- **Cheaper**: Lower hosting costs with S3 + CloudFront
- **More Reliable**: No database or server-side code to fail

## Migration Options

### Option 1: Simply Static Plugin (Recommended)

This is the easiest method for most WordPress sites.

1. **Install the Plugin**:
   - Log into your WordPress admin dashboard
   - Go to Plugins > Add New
   - Search for "Simply Static"
   - Install and activate the plugin

2. **Configure Export Settings**:
   - Go to Simply Static > Settings
   - **Delivery Method**: Select "Save as ZIP Archive"
   - **URLs**: Set "Use absolute URLs" (important!)
   - Review other settings, defaults are usually fine

3. **Generate Static Site**:
   - Go to Simply Static > Generate
   - Click "Generate Static Files"
   - Wait for the process to complete (may take several minutes)
   - Download the generated ZIP file

4. **Extract and Deploy**:
   ```bash
   # Extract the ZIP file
   unzip simply-static-*.zip -d ./website/

   # Or manually extract and copy files to the website/ directory
   ```

### Option 2: WP2Static Plugin

More advanced plugin with additional features.

1. **Install**:
   - Plugins > Add New > Search "WP2Static"
   - Install and activate

2. **Configure**:
   - Go to WP2Static settings
   - Configure your export settings
   - Set destination to "ZIP Archive" for local download

3. **Export**:
   - Run the export process
   - Download the ZIP file
   - Extract to `./website/` directory

### Option 3: HTTrack Website Copier

Command-line tool that crawls and downloads your entire site.

1. **Install HTTrack**:
   ```bash
   # Ubuntu/Debian
   sudo apt-get install httrack

   # macOS
   brew install httrack
   ```

2. **Download Your Site**:
   ```bash
   cd /home/al/Sites/vettid.org
   httrack https://www.vettid.org -O ./website-temp \
     --depth=10 \
     --ext-depth=0 \
     --robots=0 \
     --timeout=60 \
     --retries=3

   # HTTrack creates a subdirectory, move files to website/
   mv ./website-temp/www.vettid.org/* ./website/
   rm -rf ./website-temp
   ```

3. **Clean Up**:
   - Remove any WordPress admin URLs that were crawled
   - Remove `/wp-admin/` and `/wp-login.php` if present

### Option 4: wget (Manual Method)

Basic but works for simple sites:

```bash
cd /home/al/Sites/vettid.org
wget --mirror \
     --convert-links \
     --adjust-extension \
     --page-requisites \
     --no-parent \
     --directory-prefix=./website-temp \
     https://www.vettid.org

# Move files
mv ./website-temp/www.vettid.org/* ./website/
rm -rf ./website-temp
```

## Post-Export Checklist

After exporting, verify your static site:

- [ ] All HTML pages are present
- [ ] Images and assets are included
- [ ] CSS files are present
- [ ] JavaScript files are included
- [ ] Links work (check for absolute vs relative URLs)
- [ ] No WordPress admin links (wp-admin, wp-login)
- [ ] index.html exists in the root
- [ ] 404.html exists (or create a custom one)

## Common Issues and Fixes

### Issue: Links Don't Work

**Problem**: Links point to WordPress URLs instead of static files.

**Solution**:
- Use Simply Static with "Use relative URLs" option
- Or manually find and replace URLs:
  ```bash
  # Replace WordPress URLs with relative paths
  find ./website -type f -name "*.html" -exec sed -i 's|https://www.vettid.org/|/|g' {} +
  ```

### Issue: Missing Pages

**Problem**: Some pages weren't exported.

**Solution**:
- Check if pages are published (not drafts)
- Ensure pages aren't password protected
- Check Simply Static > Diagnostics for issues
- Verify sitemap.xml is accessible to crawlers

### Issue: Forms Don't Work

**Problem**: WordPress forms won't work on static site.

**Solution**:
- Replace with third-party form services:
  - Formspree (https://formspree.io)
  - Google Forms
  - Netlify Forms (if you switch to Netlify)
  - AWS API Gateway + Lambda for custom forms

### Issue: Search Functionality Lost

**Problem**: WordPress search won't work without PHP/database.

**Solution**:
- Implement client-side search (lunr.js, Algolia)
- Use Google Custom Search
- Add AWS CloudSearch or Elasticsearch

### Issue: Dynamic Content

**Problem**: Comments, recent posts, etc. won't update.

**Solution**:
- Comments: Use Disqus or similar third-party service
- Recent posts: Accept that static means you'll regenerate when content changes
- Consider using a static site generator like Hugo/Jekyll for the future

## Maintaining Your Static Site

Once deployed, to update content:

1. Make changes in WordPress (keep it running for now)
2. Re-export using your chosen method
3. Replace files in `./website/` directory
4. Run `npx cdk deploy` to update AWS

**OR**

Eventually, consider migrating to a static site generator:
- Hugo (https://gohugo.io)
- Jekyll (https://jekyllrb.com)
- Gatsby (https://www.gatsbyjs.com)
- Eleventy (https://www.11ty.dev)

These let you maintain content as Markdown files instead of keeping WordPress running.

## Testing Before Deployment

Before deploying to AWS, test locally:

```bash
# Install a simple HTTP server
npm install -g http-server

# Serve your static site locally
cd website
http-server -p 8080

# Visit http://localhost:8080 in your browser
```

Check:
- All pages load
- Images display
- Links work
- CSS/JS loads correctly
- No console errors

## Next Steps

Once you've exported and verified your static files:

1. Ensure files are in `./website/` directory
2. Follow the deployment steps in README.md
3. Deploy with `npx cdk deploy`
4. Validate SSL certificate
5. Update DNS records
6. Test the live site

## Resources

- Simply Static Docs: https://simplystatic.com/docs/
- WP2Static Docs: https://wp2static.com/documentation/
- HTTrack Manual: https://www.httrack.com/html/fcguide.html
- Static Site Generators: https://jamstack.org/generators/
