# Shiftline local development
SHELL := /bin/bash
API := npm run --workspace @shiftline/api
WEB := npm run --workspace @shiftline/web

.PHONY: help install env up down logs db db-down dev api worker web seed reset typecheck lint test e2e format backup restore

help:
	@grep -E '^[a-z-]+:.*## ' $(MAKEFILE_LIST) | awk -F':.*## ' '{printf "  %-12s %s\n", $$1, $$2}'

install: ## npm install (builds @shiftline/shared, installs git hooks)
	npm install

env: ## create apps/api/.env and apps/web/.env from the examples (development values) if missing
	@test -f apps/api/.env || cp apps/api/.env.example apps/api/.env
	@test -f apps/web/.env || cp apps/web/.env.example apps/web/.env
	@echo "env files ready (apps/api/.env, apps/web/.env)"

up: ## run the whole stack in docker (postgres, api with migrations + seed, worker, web) on :5173 and :5000
	docker compose --profile full up --build

down: ## stop the whole stack (add -v to `docker compose --profile full down` to drop the database)
	docker compose --profile full down

logs: ## follow api and worker logs
	docker compose --profile full logs -f api worker

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
