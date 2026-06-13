.PHONY: help install dev build run clean deploy

# Default target showing help
help:
	@echo "Trust402 Development and Build Tasks:"
	@echo "  make install  - Install frontend (Bun) and backend (Go) dependencies"
	@echo "  make dev      - Start Go backend and Vite frontend concurrently in development mode"
	@echo "  make build    - Compile React production bundle and Go backend binary"
	@echo "  make run      - Run the production binary serving compiled static files"
	@echo "  make clean    - Remove build artifacts (dist/ and bin/)"
	@echo "  make deploy   - Push the latest committed changes to Heroku for deployment"

# Install all dependencies
install:
	@echo "Installing package dependencies using Bun..."
	bun install

# Start development servers
dev:
	@echo "Starting development servers..."
	bun run dev

# Build for production
build:
	@echo "Building production bundles..."
	bun run build
	@echo "Build complete! Production files are located in dist/."

# Run production build
run:
	@echo "Running production server on port 5001..."
	bun start

# Clean build artifacts
clean:
	@echo "Cleaning build artifacts..."
	rm -rf dist bin
	@echo "Clean complete."

# Deploy to Heroku
deploy:
	@echo "Pushing changes to origin main..."
	git push origin main
	@echo "Deploying latest commit to Heroku..."
	git push heroku main

