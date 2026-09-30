# hodclub.in

Customer website source for the `hodclub-customer` Cloudflare Pages project. The
live site was restored by **manual upload** of these files; pushing to GitHub
does not currently publish a new version.

For a reviewed deployment, upload the **contents of this repository root** to
that Pages project, retaining `_worker.js` (Pages advanced mode) and `404.html`.
Do not upload a ZIP as the site or publish this folder to the POS project.
Check the deployed wallet routes, menu, and public pages after upload. Leave
Firebase, payments, DNS, and the separate POS project unchanged.

`_worker.js` handles root wallet query links, known documents/assets, retired
paths, security headers, and unknown-page responses. The old Netlify redirect
configuration and retired scanner/legacy HTML are deliberately not included.
