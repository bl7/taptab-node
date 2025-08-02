#!/bin/bash

echo "Installing dependencies..."
npm install

echo "Generating Prisma client..."
npm run prisma:generate

echo "Building TypeScript..."
npm run build

echo "Build completed!"
ls -la dist/ 