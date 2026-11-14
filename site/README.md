# site/

The marketing site: plain HTML/CSS/JS, no build step, no framework. Served at the deployment's root
("/"); the app is under `/app/` (see `deploy/nginx.conf`).

`index.html` is the landing page; `terms.html`, `privacy.html`, `contact.html`, `about.html` are
standalone pages linked from its footer. All five are copied into the bundle as-is — nothing here is
generated.
