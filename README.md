# openevnt/action

A GitHub action that allows you to publish [Open Evnt](https://evnt.directory/) files into GitHub Pages.

This action will:

- Create a `github-pages` artifact to publish
  - `events/**/*.evnt.json` -> event data
  - `feed.json` -> JSON Feed of events

This action uses the `@evnt/dev` package
