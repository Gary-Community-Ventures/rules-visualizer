# Frontend Template

This project is a frontend template built with the following technologies:

## Tech Stack

- **React**: A JavaScript library for building user interfaces.
- **Vite**: A fast build tool that provides a lightning-fast development experience.
- **TypeScript**: A superset of JavaScript that adds static types.
- **Zod**: A TypeScript-first schema declaration and validation library.
- **Shadcn UI**: A collection of re-usable components built using Radix UI and Tailwind CSS.
- **Tailwind CSS**: A utility-first CSS framework for rapidly building custom designs.
- **TanStack Router**: A powerful routing library for React, providing type-safe, non-file-based routing.
- **React Context**: React's built-in way to share data that can be considered "global" for a tree of React components.
- **Google Tag Manager**: A tag management system to quickly and easily update tags and code snippets on your website.
- **Prettier**: An opinionated code formatter.
- **ESLint**: A pluggable linting utility for JavaScript and JSX.
- **Git**: A distributed version control system.


## Getting Started

To run the project locally, follow these steps:

1.  **Install dependencies**:

    ```bash
    npm install
    ```

2.  **Start the development server**:

    ```bash
    npm run dev
    ```

## Available Commands

- `npm run dev`: Starts the development server.
- `npm run build`: Builds the project for production.
- `npm run format`: Formats the code using Prettier.
- `npm run lint`: Runs ESLint to check for code quality issues.
- `npm run preview`: Serves the production build locally for preview.
- `npx shadcn@latest add <component-name>`: Adds a new component from Shadcn UI. Replace `<component-name>` with the name of the component you want to add (e.g., `button`, `input`, `card`). The components will be added to `src/components/ui/`.

## TODOs

- Remember to replace `GTM_CONTAINER_ID` in `index.html` with your actual Google Tag Manager ID.
- Add Clerk credentials by adding `VITE_CLERK_PUBLISHABLE_KEY=[API_KEY]` to the `.env` file
