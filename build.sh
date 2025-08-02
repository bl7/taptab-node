#!/bin/bash

echo "Installing dependencies..."
npm install

echo "Building TypeScript..."
npm run build

echo "Build completed!"
ls -la dist/ 