# hodclub.in — current customer website

HOD CUSTOMER WEBSITE — COMPLETE FOLDER — 6 NOVEMBER 2026

KEEP THIS ENTIRE PACKAGE ON YOUR MAC.
HOD-CUSTOMER-SITE is the COMPLETE website folder, not a patch.
There is no apply.command to run for this complete package.

UPLOAD:
1. Unzip this package.
2. Cloudflare > Workers & Pages > hodclub-customer > Create deployment.
3. Select Production and upload the CONTENTS of HOD-CUSTOMER-SITE.
   index.html and _worker.js must be at the deployment root, not nested
   inside another folder. Do not upload this outer package or BACKUPS.
4. Inspect the file list before clicking Save and deploy.
5. Check hodclub.in, menu, a valid wallet link, and hodclub.in/dj-academy.

The Academy page has been added; no other public page was rewritten.
The prior Functions and POS packages are separate and still required.
No campaign is launched and no messages are resent by this site upload.

SOURCE AND BACKUPS:
- Public files were freshly downloaded from hodclub.in.
- Routing (_worker.js), _headers and 404.html come from the saved GitHub
  source. Live security headers matched that router's CSP on all 15 assets.
- Cloudflare's account API was unavailable. Its private deployed Worker
  source and account configuration could NOT be exported or compared.
  This is a complete reconstructed website package, NOT a full account
  backup. DNS, domain settings, Firebase and payments are not included.
- BACKUPS contains the previous GitHub snapshot and pre-Academy website
  reconstruction. The latter has the same private-config limitation.
- SOURCE-MANIFEST.json records every file hash and its source.

GITHUB:
houseofdopamineclub/hodclub-site is the website source repository.
The project is documented as manual Cloudflare upload, not automatic Git
publishing. Download Code > Download ZIP to keep a local source copy.
Files do not update on your Mac by themselves: download the latest ZIP or
pull Git changes, and keep the updated folder after every future change.
Only upload to hodclub-customer, never the POS project.


GitHub root contains the website files directly. README.md is documentation, not an app dependency. Before updating, retain a dated snapshot/branch. Never deploy the obsolete September snapshot over the current wallet/menu fixes.
