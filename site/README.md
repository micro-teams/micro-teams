# site/

The marketing site: plain HTML/CSS/JS, no build step, no framework, independent of `app/`. Served
at the deployment's root ("/") — see `deploy/nginx.conf` for why that is where the app used to be,
and where the app moved to instead.

`index.html` is the landing page; `terms.html`, `privacy.html`, `contact.html`, `about.html` are
standalone pages linked from its footer. All five are copied into the bundle as-is at
assembly time (`package-zip` in `.github/workflows/build.yml`) — nothing here is generated.
