# Decisions

## Crossref rather than CiNii API

CiNii Web API requires an application ID and asks commercial-site users to contact NII before applying. Crossref provides a public, registration-free REST API whose metadata is broadly reusable. The first release therefore uses Crossref and does not depend on credentials that would obstruct a public pilot or later commercialization.

## Metadata, not content

Only bibliographic fields needed to identify a paper are returned. Abstracts, full text, images, and reference text are excluded because their rights can differ from the surrounding metadata.

## Search privacy

Search fields are sent to the product API and Crossref only for the search. They never enter product URLs, D1 telemetry, logs intentionally emitted by the application, or saved browser state.

## No account

Saved papers are public metadata and remain in localStorage, so authentication would add friction and personal-data handling without improving the initial job.
