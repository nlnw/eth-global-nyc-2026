.PHONY: help install dev build run clean

# Default target showing help
help:
	@echo "Trust402 Development and Build Tasks:"
	@echo "  make install  - Install frontend (Bun) and backend (Go) dependencies"
	@echo "  make dev      - Start Go backend and Vite frontend concurrently in development mode"
	@echo "  make build    - Compile React production bundle and Go backend binary"
	@echo "  make run      - Run the production binary serving compiled static files"
	@echo "  make clean    - Remove build artifacts (dist/ and bin/)"

# Install all dependencies
install:
	@echo "Installing Go backend dependencies..."
	go mod tidy
	@echo "Installing React frontend dependencies using Bun..."
	bun install

# Start development servers
dev:
	@echo "Starting development servers..."
	bun run dev

# Build for production
build:
	@echo "Building frontend production bundle..."
	bun run build
	@echo "Building Go backend binary..."
	mkdir -p bin
	go build -o bin/main main.go
	@echo "Build complete! Production files are located in dist/ and bin/main."

# Run production build
run:
	@echo "Running production server on port 5001..."
	./bin/main

# Clean build artifacts
clean:
	@echo "Cleaning build artifacts..."
	rm -rf dist bin
	@echo "Clean complete."
