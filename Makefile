# Shiftline local development
SHELL := /bin/bash
API := npm run --workspace @shiftline/api
WEB := npm run --workspace @shiftline/web

.PHONY: help install db db-down dev api web seed reset typecheck lint test format

help:
	@grep -E '^[a-z-]+:.*## ' $(MAKEFILE_LIST) | awk -F':.*## ' '{printf "  %-12s %s\n", $$1, $$2}'

install: ## npm install (builds @shiftline/shared, installs git hooks)
	npm install

db: ## start PostgreSQL (docker) and wait for it
	docker compose up -d postgres
	@until docker compose exec -T postgres pg_isready -U shiftline -d shiftline >/dev/null 2>&1; do sleep 1; done
	@echo "postgres ready on localhost:5432"

db-down: ## stop PostgreSQL
	docker compose down

dev: ## run api and web on the host (needs `make db`)
	npx concurrently -k -n api,web -c blue,green "$(API) dev" "$(WEB) dev"

api: ## run only the api
	$(API) dev

web: ## run only the web app
	$(WEB) dev

seed: ## seed the demo tenant into DATABASE_URL
	$(API) db:seed

reset: ## drop and recreate the local schema, then seed (development only)
	npx -w @shiftline/api prisma migrate reset --force --skip-seed
	$(MAKE) seed

typecheck: ## typecheck all workspaces
	npm run typecheck

lint: ## lint all workspaces
	npm run lint

test: ## run all tests
	npm run test

format: ## prettier --write
	npm run format
