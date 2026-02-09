# Project Overview

This is a frontend project built with:

- **React**
- **Vite**
- **TypeScript**
- **Tailwind CSS**
- **Shadcn UI**
- **TanStack Router**
- **ESLint** and **Prettier**

# Agent Interaction Guidelines

When performing tasks within this project, the agent should adhere to the following:

## 1. Code Style and Formatting

- Adhere to the existing code style and formatting. Prettier and ESLint are configured.
- Run linting and formatting checks before committing changes `npm run format`.

## 2. Dependency Management

- Use `npm` for package management.
- Install new dependencies using `npm install <package-name>`.
- Install dev dependencies using `npm install -D <package-name>`.

## 3. File Structure

- Place custom React components in `src/components/`.
- Shadcn UI components are located in `src/components/ui/`.
- The main context provider is located in `src/context.tsx`.
- Routing logic is in `src/routes.tsx`.
- Place new pages in `src/pages/`

## 4. General

- Always prioritize maintaining the existing project conventions and architecture.
- Be mindful of `tsconfig.json` and `vite.config.ts` for path aliases and build configurations.
