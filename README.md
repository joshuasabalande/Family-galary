# My Photo Gallery

An interactive photo gallery built with plain HTML, CSS and JavaScript.

## Show photos to everyone
Every photo inside the `images/` folder of this repository appears in the gallery for all visitors.

1. Open your repository on GitHub and go to the `images` folder.
2. Click **Add file > Upload files**, drop your pictures in, then **Commit changes**.
3. Wait about a minute, then refresh your site. The new photos appear automatically.

To remove a photo for everyone, delete it from the `images` folder on GitHub.

Visitors can also upload their own photos with the upload button, but those are saved only in their own browser and are not seen by other people.

## How the photo list is found
- On `username.github.io` sites, the page reads the `images` folder through the GitHub API automatically.
- If it can't (custom domain, or no internet to GitHub), it falls back to `photos.json`, a list of file names, for example `["beach.jpg", "family.png"]`. You can also set `user` and `repo` at the top of `script.js`.

## Files
- `index.html`, `style.css`, `script.js` - the gallery
- `images/` - photos everyone can see
- `photos.json` - optional fallback list of photo file names

## Put it on GitHub Pages
1. Upload all files and the `images` folder to a new repository.
2. Go to **Settings > Pages**, choose **Deploy from a branch**, pick `main` and `/ (root)`, then **Save**.
3. Your site is live at `https://YOUR-USERNAME.github.io/REPOSITORY-NAME/`.
