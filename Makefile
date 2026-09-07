# Shiftline local development
SHELL := /bin/bash
API := npm run --workspace @shiftline/api
WEB := npm run --workspace @shiftline/web

.PHONY: help install db db-down dev api worker web seed reset typecheck lint test e2e format backup restore

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

dev: ## run api (with embedded worker) and web on the host (needs `make db`)
	npx concurrently -k -n api,web -c blue,green "EMBED_WORKER=true $(API) dev" "$(WEB) dev"

api: ## run only the api
	$(API) dev

worker: ## run only the background worker (pg-boss)
	$(API) worker

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

e2e: ## browser smoke suite against a seeded local database (starts api and web itself)
	npm run e2e

backup: ## pg_dump DATABASE_URL into ./backups (same format as the nightly job)
	scripts/backup.sh

restore: ## restore a dump: make restore DUMP=backups/<file>.dump TARGET=postgresql://.../shiftline_restore
	scripts/restore.sh "$(DUMP)" "$(TARGET)" --drop

format: ## prettier --write
	npm run format
