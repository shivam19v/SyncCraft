.PHONY: setup proto up down dev-redis test

setup: proto
	cd services/gateway && go mod tidy
	cd services/doc && npm install
	cd apps/web && npm install

proto:
	npm install
	npx buf generate

up: proto
	docker compose up --build

down:
	docker compose down

# Redis only – run the three services natively (see README)
dev-redis:
	docker compose up redis

test:
	cd services/gateway && go test ./...
	cd services/doc && npm run typecheck
