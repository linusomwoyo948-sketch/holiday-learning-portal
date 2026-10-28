# Holiday Learning Portal

A holiday learning website for many schools. The site owner approves schools, principals set up classes and approve teachers, teachers post materials, assignments and timed exams, students sign in with their admission number and parents follow their child's work.

It runs on **Netlify** (the website and its server functions) with **Supabase** (database, file storage and teacher sign-in).

## How people sign in

| Who | How | Needs email? |
| --- | --- | --- |
| Students | School name, admission number and class | No |
| Parents | School name, child's admission number, class and the PIN the child set | No |
| Teachers, principals, site owner | A 6-digit code sent to their email, or **Continue with Google** | Yes |

The emailed code is typed into the page, so it works whichever phone, computer or email app opens the email. If someone taps the link in the email instead, the link also works on any device: it signs in the browser that opens it.

## What is in this folder

| Path | What it is |
| --- | --- |
| `src/` | The website (React). `src/platform/client.ts` handles sign-in, server calls, file uploads and phone alerts |
| `backend/index.ts` | All the rules: schools, teachers, students, materials, exams, assignments, parents, backups |
| `server/platform.ts` | Connects the rules to Supabase (database, files, sign-in checks) and sends phone alerts |
| `netlify/functions/api.mts` | Runs `backend/index.ts` for every `/api/...` request |
| `netlify/functions/nightly-backup.mts` | Saves a full backup every night at 02:00 Nairobi time |
| `supabase/schema.sql` | The database and file storage setup to paste into Supabase once |
| `public/sw.js` | Shows phone alerts |
| `local/` | Test server and automatic checks for running everything on your own computer |
| `netlify.toml` | Netlify build settings and security headers |

## One-time setup

Do the steps in order. Each step lists exactly what to type, because a single wrong address is the most common reason sign-in fails on other devices.

### 1. Supabase project

1. Go to https://supabase.com and sign in with GitHub. Click **New project**.
2. Name it `holiday-learning-portal` and choose a strong database password (save it somewhere safe).
3. **Region: choose East US (North Virginia).** Netlify runs the server functions in the United States, and every page makes several database calls. A database on the same side of the ocean makes the portal noticeably faster for everyone, including users in Kenya.
4. Wait for the project to finish setting up.
5. Open **SQL Editor > New query**, paste the whole of `supabase/schema.sql`, click **Run**. It should say "Success". This creates the database table and a private file store called `files`.
6. Open **Project Settings > API Keys** and note:
   - the **Project URL** (looks like `https://abcd1234.supabase.co`; it is also under Project Settings > Data API),
   - the **Publishable key** (`sb_publishable_...`), which is safe to be public,
   - the **Secret key** (`sb_secret_...`). Keep it private and only paste it into Netlify.

### 2. Netlify (the website)

1. Go to https://app.netlify.com and sign in with GitHub.
2. **Add new site > Import an existing project > GitHub**, and pick this repository. Netlify reads the build settings from `netlify.toml`, so leave them as they are.
3. Under **Environment variables**, add:

   | Name | Value |
   | --- | --- |
   | `VITE_SUPABASE_URL` | your Supabase Project URL |
   | `VITE_SUPABASE_PUBLISHABLE_KEY` | your Supabase Publishable key |
   | `SUPABASE_URL` | your Supabase Project URL (again) |
   | `SUPABASE_SECRET_KEY` | your Supabase Secret key (mark it as secret) |

4. Deploy. When it finishes, open **Site configuration > Change site name** and choose a name, for example `holiday-learning` gives `https://holiday-learning.netlify.app`. **Write down this exact address.** Steps 3 and 5 need it.
5. If you add or change environment variables later, open **Deploys > Trigger deploy > Deploy site** so the website picks them up.

### 3. Supabase sign-in addresses (the most important step)

In Supabase open **Authentication > URL Configuration**:

- **Site URL**: your exact Netlify address from step 2, starting with `https://` and with no slash at the end, for example `https://holiday-learning.netlify.app`.
- **Redirect URLs**: click **Add URL** and add the same address followed by `/**`, for example `https://holiday-learning.netlify.app/**`.

If this still says `http://localhost:3000`, sign-in links and Google sign-in send people to a page that does not exist on their phone.

### 4. Sign-in emails with a 6-digit code

**a. Put the code in the emails.** In Supabase open **Authentication > Emails > Templates**. Change **two** templates, because first-time users get "Confirm signup" and returning users get "Magic Link".

For both **Confirm signup** and **Magic Link**, set the subject to:

```
Your Holiday Learning Portal sign-in code
```

and replace the message body with:

```html
<h2>Your sign-in code</h2>
<p>Type this code on the Holiday Learning Portal sign-in page:</p>
<p style="font-size:28px;font-weight:bold;letter-spacing:6px">{{ .Token }}</p>
<p>The code works for one hour. You can also <a href="{{ .ConfirmationURL }}">tap here to sign in</a> on this device.</p>
<p>If you did not ask to sign in, you can ignore this email.</p>
```

**b. Connect a real email sender.** Supabase's built-in sender only delivers to members of your own Supabase team, so teachers would never receive their code. If you have no website domain of your own, a Gmail account works:

1. Use a Gmail account for the portal (a new one such as `holidaylearningportal@gmail.com` is best).
2. On that account turn on **2-Step Verification** (https://myaccount.google.com/security).
3. Open https://myaccount.google.com/apppasswords, create an app password named `Supabase`, and copy the 16-letter password.
4. In Supabase open **Authentication > Emails > SMTP Settings**, turn on **Enable custom SMTP** and enter:

   | Field | Value |
   | --- | --- |
   | Sender email | the Gmail address |
   | Sender name | `Holiday Learning Portal` |
   | Host | `smtp.gmail.com` |
   | Port | `465` |
   | Username | the Gmail address |
   | Password | the 16-letter app password (no spaces) |

5. Open **Authentication > Rate Limits** and raise **Rate limit for sending emails** to `100` per hour, so a whole staff room can sign in on the first morning.

Gmail can send about 500 emails a day, which is plenty for sign-in codes. For more, use an email service such as Resend or Brevo with your own domain and put its SMTP details in the same place.

### 5. Google sign-in (recommended)

1. Go to https://console.cloud.google.com and create a project called `Holiday Learning Portal`.
2. **APIs & Services > OAuth consent screen**: choose **External**, app name `Holiday Learning Portal`, and your email as support and developer contact. Add your Netlify address under authorised domains if asked (for example `holiday-learning.netlify.app`).
3. **Publish the app.** On the OAuth consent screen (or **Audience**) page, click **Publish app** so the status says **In production**. While it says "Testing", only the test users you list can sign in and everyone else sees "Access blocked". The portal only asks for name and email, so Google does not need to review it.
4. **APIs & Services > Credentials > Create credentials > OAuth client ID**: type **Web application**. Under **Authorised redirect URIs** add your Supabase Project URL followed by `/auth/v1/callback`, for example `https://abcd1234.supabase.co/auth/v1/callback`. Create it, then copy the **Client ID** and **Client secret**.
5. In Supabase open **Authentication > Sign In / Providers > Google**, turn it on, paste the Client ID and Client secret, and save.

To hide the Google button and use only email codes, set `VITE_GOOGLE_SIGNIN` to `off` in Netlify and redeploy.

### 6. Check sign-in from a second device before anyone else uses the site

Use a phone that has **never** opened the site and is **not on your home Wi-Fi** (turn Wi-Fi off and use mobile data):

1. Open your Netlify address. The home page loads.
2. Under **Teachers & principals**, type an email address that is **not** your Supabase account email and tap **Email me a sign-in code**. The email arrives within a minute (check spam the first time).
3. Type the code. You are signed in.
4. Sign out and repeat with a second email, this time opening the email on a **different** device (for example a computer) and typing the code on the phone. You are signed in.
5. Sign out and tap **Continue with Google** with a Google account that is not yours. You are signed in, not shown "Access blocked".
6. Sign in as the site owner (`linusomwoyo948@gmail.com`). The owner page opens.

If any step fails, see **If sign-in does not work** below before inviting schools.

### 7. Move the data from the old site

Do this when schools are not busy (for example in the evening), and ask teachers not to post on the old site while you move.

1. **Records.** On the old site (holiday-learning-portal-87ltis.v2.appdeploy.ai) sign in as the site owner, click **Back up now**, then **Download** next to the new backup. On the new site sign in as the site owner, click **Upload backup file**, choose that file, click **Restore** next to it and type `RESTORE`. Keep the page open until it finishes.
2. **Files.** On the old site click **Download file list**. Straight away, on the new site, click **Copy files from a list** and choose that file. Keep the page open until it finishes. The links in the list stop working after a few hours. If some files fail, download a new list and copy again.
3. **Check.** Sign in on the new site as a teacher and as a student and open a few materials.
4. **Tell the schools** the new address. Teachers and principals sign in with the same email address as before and find their accounts, classes and work. Students and parents sign in exactly as before. Phone alerts must be switched on again on each phone.

### 8. Your own domain (optional)

In Netlify open **Domain management > Add a domain**, enter your domain and follow the DNS instructions (Netlify adds free HTTPS). Then, in Supabase, change the **Site URL** to the new address and add `https://your-domain/**` to **Redirect URLs**. In Google Cloud, add the domain to the consent screen's authorised domains.

## If sign-in does not work

| What you see | Cause | Fix |
| --- | --- | --- |
| The code email never arrives (except to your own Supabase email) | No custom email sender | Step 4b |
| The email has a link but no code | Templates not changed | Step 4a, both templates |
| "Too many codes were requested" | Email rate limit | Step 4b.5, then wait an hour |
| Google says "Access blocked" or "This app is in testing" | Google app not published | Step 5.3 |
| Google says "redirect_uri_mismatch" | Wrong redirect address in Google | Step 5.4 |
| After Google or the email link you land on a page that will not open, or on `localhost` | Wrong Site URL or Redirect URLs | Step 3 |
| Signed in, but "Please sign in" errors appear | Netlify keys wrong or added after deploy | Step 2.3, then Trigger deploy |
| The site is very slow | Supabase far from Netlify | Make a new Supabase project in East US and move the data (step 7) |

## Making changes

Every change pushed to the `main` branch on GitHub is published by Netlify automatically within a couple of minutes.

To try changes on your own computer first (Node.js 20 or newer):

```
npm install
npm run local
```

Then open http://localhost:5173. Test mode signs you in with any email address straight away and keeps data in `local-data.json` and files in `local-files/`, never touching the live site. With the test server running, `node local/smoke-test.mjs` runs an automatic check of the main features.

## Good to know

- Free Supabase projects pause after a week with no visits. If that happens, open the Supabase dashboard and click **Restore**. Regular use keeps the project awake.
- Free Supabase projects include 500 MB of database and 1 GB of file storage. The owner page shows weekly usage. Upgrade the Supabase plan if many schools upload large files.
- The database and file store are locked, so browsers can never read them directly. Only the server functions (using the Secret key) can, and files are shared through links that expire after a few hours.
- Never put the Secret key in the code or share it in chat. If it leaks, create a new one in Supabase and update it in Netlify.
