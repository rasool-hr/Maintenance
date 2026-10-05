# Maintenance Work Order: GitHub + Vercel setup

This project keeps the mobile-friendly frontend and saves each completed work order into a GitHub repository through a Vercel serverless function. The GitHub token stays only in Vercel environment variables and is never exposed in the browser.

## Files

- `index.html` - frontend for the technician/tenant workflow
- `api/save-work-order.js` - Vercel serverless function that creates one GitHub commit containing the work order JSON, before photo, after photo, and signature
- `vercel.json` - Vercel function configuration

## 1. Create a private GitHub data repository

Create a separate private repository, for example `maintenance-data`. Initialize it with a README so the `main` branch exists.

Completed orders will be stored as:

```
maintenance-orders/
  WO-YYYYMMDD-HHMMSS-XXXX/
    order.json
    before.jpg
    after.jpg
    signature.png
```

Keeping the data repository private is strongly recommended because tenant names, photos, and signatures may be sensitive.

## 2. Create a fine-grained GitHub token

Create a fine-grained personal access token restricted to only the private data repository.

Repository permission required:
- Contents: Read and write

Do not put this token in `index.html`, GitHub Pages, or any public repository file.

## 3. Deploy the backend to Vercel

Import the repository containing these files into Vercel.

In Vercel Project Settings > Environment Variables, add:

- `GITHUB_TOKEN` = your fine-grained GitHub token (Secret)
- `GITHUB_OWNER` = your GitHub username or organization
- `GITHUB_REPO` = the private data repository name, for example `maintenance-data`
- `GITHUB_BRANCH` = `main`
- `ALLOWED_ORIGIN` = your GitHub Pages origin, for example `https://USERNAME.github.io`

Redeploy after adding or changing environment variables.

## 4. Copy the Vercel API URL

After deployment, your endpoint will look like:

```
https://YOUR-VERCEL-PROJECT.vercel.app/api/save-work-order
```

Open `index.html` and replace:

```js
var SAVE_API_URL="https://YOUR-VERCEL-PROJECT.vercel.app/api/save-work-order";
```

with your real Vercel URL.

Commit the updated `index.html` to the GitHub Pages repository.

## 5. Test

On the mobile webpage:

1. Fill property/unit, tenant, and maintenance request.
2. Add before photo.
3. Add after photo.
4. Add tenant signature.
5. Add notes if needed.
6. Tap **Complete work order**.

The frontend should show a completed work order ID, and the private GitHub data repository should receive one new folder and one commit containing all four files.

## Security note

This is appropriate for a class prototype, but GitHub is not a production maintenance database. The API token remains server-side, but the public endpoint could still be abused if there is no login. `ALLOWED_ORIGIN` reduces casual browser abuse; a real deployment should add authentication and authorization before storing tenant data or signatures.
