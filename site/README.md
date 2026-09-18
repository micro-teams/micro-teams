# site/

The marketing site: plain HTML/CSS/JS, no build step, no framework, independent of `app/`. Served
at the deployment's root ("/") — see `deploy/nginx.conf` for why that is where the app used to be,
and where the app moved to instead.

`index.html` is the landing page; `terms.html`, `privacy.html`, `contact.html`, `about.html` are
standalone pages linked from its footer. All five are copied into the bundle as-is by
`app/tool/assemble-dist.mjs` — nothing here is generated.

That same script puts the app under `/app/` and points its documents at that mount, and
`app/tool/check-bundle.sh` opens the result in a real browser behind the real `deploy/nginx.conf`.
Anything that changes where either half is served belongs in those two files, together: T-093 was
this split shipping with only the nginx half checked.
