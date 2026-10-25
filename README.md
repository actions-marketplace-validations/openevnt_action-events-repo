# openevnt/action

A GitHub action that allows you to publish [Open Evnt](https://evnt.directory/) files into GitHub Pages.

This action will:

- Create a `github-pages` artifact to publish
  - `events/**/*.evnt.json` -> event data
  - `feed.json` -> JSON Feed of events
  - `index.json` -> [Open Evnt Index](https://evnt.directory/spec/open-evnt-index) of events, linking to them
    under `pages-url` (by default `https://<owner>.github.io/<repo>/`)

Every event is checked against the Open Evnt JSON Schema, by default the one at
<https://evnt.directory/openevnt.schema.json>. Set `schema-url` to check against another.
