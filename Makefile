.PHONY: help install dev test lint build version bump release release-draft

VERSION := $(shell node -p "require('./manifest.json').version")

help:
	@echo "make install        npm ci"
	@echo "make dev            watch-build main.js"
	@echo "make test           run the test suite"
	@echo "make lint           run eslint"
	@echo "make build          typecheck + production build"
	@echo "make version        print the version from manifest.json"
	@echo "make bump V=x.y.z   bump version in package.json/manifest.json/versions.json and commit"
	@echo "make release        publish $(VERSION) via GitHub Actions"
	@echo "make release-draft  same, but as a draft release"

install:
	npm ci

dev:
	npm run dev

test:
	npm test

lint:
	npm run lint

build:
	npm run build

version:
	@echo $(VERSION)

# Updates package.json, manifest.json, versions.json and commits (no git tag: the workflow creates it).
bump:
	@test -n "$(V)" || { echo "Usage: make bump V=x.y.z"; exit 1; }
	npm version $(V) --no-git-tag-version
	git add package.json package-lock.json manifest.json versions.json
	git commit -m "Release $(V)"

# The workflow lints/tests/builds, then creates the GitHub release (tag = manifest.json version).
# Requires: gh CLI logged in, changes committed AND pushed, version bumped (make bump).
release: lint test
	@test -z "$$(git status --porcelain)" || { echo "Working tree not clean: commit first"; exit 1; }
	@test "$$(git rev-parse HEAD)" = "$$(git rev-parse @{u})" || { echo "Unpushed commits: git push first"; exit 1; }
	gh workflow run release.yml -f publish=true
	@echo "Started release $(VERSION). Watch with: gh run watch"

release-draft: lint test
	gh workflow run release.yml -f publish=false
