# Analyst Hub

A web app for Counterpoint analysts. Each person signs in with an email and password, picks the region they
cover, and runs their recurring tasks: weekly blog topics and 3-page Word drafts, commentary, report sections,
research briefs, rewrites and more. Every prompt follows the chosen region. Word files use the company font,
template and logo that the admin uploads.

## How it fits together

| Piece | What it does | Cost |
|---|---|---|
| **GitHub Pages** | Hosts the page (this folder) | Free |
| **Supabase** | Sign-in, users, settings, saved drafts, brand files | Free tier is enough |
| **Cloudflare Worker** | Holds the Claude API key and calls Claude; manages users | Free tier is enough |
| **Claude API** | Research and writing | Pay as you go: about $2-6 per weekly topics run, $1-3 per draft |

The Worker is there because Claude's research can take several minutes, longer than Supabase's own functions allow,
and so the API key never sits in anyone's browser.

## Setup (about 30 minutes, all in the browser)

### 1. Supabase (accounts and data)
1. Create a free account at https://supabase.com and a **New project** (pick a region close to you, save the database password).
2. **Authentication > Sign In / Providers**: keep Email on, turn **off** "Allow new users to sign up" (only the admin adds people)
   and turn off "Confirm email".
3. **Authentication > Users > Add user > Create new user**: your email and a password, tick "Auto Confirm User".
4. **SQL Editor > New query**: paste all of `backend/supabase.sql`, check the email on the last line is yours, click **Run**.
   You are now the admin.
5. **Project Settings > API Keys**: copy the **Project URL**, the **anon / publishable** key, and the **service_role / secret** key.
   The secret key goes only into the Worker, never into the page.

### 2. Cloudflare Worker (talks to Claude)
1. Create a free account at https://dash.cloudflare.com. Go to **Workers & Pages > Create > Create Worker** ("Start with Hello World"),
   name it `analyst-hub`, click **Deploy**.
2. Click **Edit code**, replace everything with the contents of `backend/worker.js`, click **Deploy**.
3. **Settings > Variables and Secrets > Add**:
   - `ANTHROPIC_API_KEY` (Secret): your Claude API key from https://console.anthropic.com (add credit, turn on auto-reload)
   - `SUPABASE_URL` (Text): the Project URL
   - `SUPABASE_SERVICE_KEY` (Secret): the service_role / secret key
   - `ALLOWED_ORIGINS` (Text): your GitHub Pages address, e.g. `https://yourname.github.io` (no path, no slash at the end)
4. Copy the Worker's address, e.g. `https://analyst-hub.yourname.workers.dev`.

### 3. The page (GitHub Pages)
1. Open `config.js` and fill in the three values: Supabase Project URL, the anon/publishable key, the Worker address.
2. Create a **public** GitHub repository named `analyst-hub` and upload everything in this folder
   (`index.html`, `app.js`, `engine.js`, `prompts.js`, `config.js`, `vendor/`). The `backend/` folder is optional to upload:
   it holds no secrets, just the setup files.
3. **Settings > Pages**: Source "Deploy from a branch", branch `main`, folder `/ (root)`, Save.
4. After a minute, open `https://yourname.github.io/analyst-hub/` and sign in.

### 4. First run
1. **Settings > My coverage**: pick your region, save.
2. **Document branding**: upload the font (regular, and bold if you have it), the Word template (.docx or .dotx) and the logo (PNG or JPG).
3. **Users**: add each analyst with email, password, name and region. Share the password with them privately.
4. Open **Weekly blog topics** and press "Find this week's topics".

## Regions
Allowed: Middle East and/or Africa (both = MEA) · APAC, India and/or China · East and/or West Europe · LATAM with North America
(always together). The page, the database and the Worker all enforce the same rule. Country lists, regional news outlets,
seasonal moments and policy themes for each region are in `prompts.js` (`HUB.REGIONS`); edit them on GitHub and the site updates
in about a minute.

## Branding rules for Word files
- **Template**: its styles, theme, page size and margins, and footer are used. The template's body text is ignored.
- **Logo**: goes top right in the header. If a logo is uploaded, it replaces the template's header; remove the logo to use the
  template's own header.
- **Font**: embedded in every file so it shows correctly on any computer, and used for the charts too. Its name is read
  from the font file.
- PowerPoint templates are not used yet, because the hub produces Word files only.

## Security
- Passwords are handled by Supabase. Analysts can change only their own name, title and region; roles, access and
  passwords are changed by an admin through the Worker.
- The Claude API key lives only in the Worker. The page only ever sees the public Supabase key.
- Each person sees only their own drafts and results. Brand files can be read by any signed-in user, changed by admins only.
- Turning a user off blocks sign-in and Claude access immediately.
- Text and files run through the hub go to the Claude API. Check Counterpoint's policy before using internal data.
