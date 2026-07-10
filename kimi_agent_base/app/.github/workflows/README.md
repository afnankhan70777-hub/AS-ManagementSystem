# GitHub Actions Deployment Setup

This GitHub Actions workflow automatically builds and deploys the AS Swift Financials app to GitHub Pages whenever you push to the main branch.

## Setup Instructions

### 1. Enable GitHub Pages

1. Go to your repository on GitHub: `https://github.com/afnankhan70777-hub/AS-ManagementSystem`
2. Click **Settings** → **Pages**
3. Under "Source", select **GitHub Actions**

### 2. Add Repository Secrets

The workflow needs your Supabase credentials. Add these as GitHub secrets:

1. Go to **Settings** → **Secrets and variables** → **Actions**
2. Click **New repository secret** and add:

| Secret Name | Value |
|-------------|-------|
| `VITE_SUPABASE_URL` | `https://roegfbnnhatbaykpcjhr.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | Your Supabase anon key |
| `VITE_USE_SUPABASE` | `true` |

### 3. Update vite.config.ts

The vite config has been updated to use the correct base path for GitHub Pages:

```typescript
base: '/AS-ManagementSystem/',
```

### 4. Push Changes

Push the workflow file to trigger the first deployment:

```bash
git add .github/workflows/
git commit -m "Add GitHub Actions deployment"
git push origin main
```

### 5. Monitor Deployment

1. Go to **Actions** tab in your repository
2. Watch the workflow run
3. Once complete, your site will be live at:
   `https://afnankhan70777-hub.github.io/AS-ManagementSystem/`

## How It Works

1. **Trigger**: Workflow runs on every push to `main` or `master`
2. **Build**: Installs dependencies and builds the app with Vite
3. **Deploy**: Uploads the `dist/` folder to GitHub Pages
4. **Live**: Site updates automatically within 1-2 minutes

## Manual Trigger

You can also run the workflow manually:
1. Go to **Actions** → **Deploy to GitHub Pages**
2. Click **Run workflow**

## Troubleshooting

### Build fails
- Check that `package-lock.json` exists
- Verify Node.js version compatibility (v20)

### Deployment fails
- Ensure GitHub Pages is enabled
- Check that secrets are set correctly
- Verify repository permissions

### App shows 404
- Check that vite.config.ts has correct `base` path
- Ensure workflow uses correct artifact path
