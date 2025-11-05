# Reusable Footer Component

This Footer component is designed to be easily copied and used across all Deep Design projects.

## Quick Setup

1. **Copy the component file**
   - Copy `Footer.reusable.tsx` to your project's components folder
   - Rename it to `Footer.tsx` if desired

2. **Copy the logo assets**
   - Copy the entire `_other logos` folder from `public/_other logos/` to your project's `public/` folder
   - Ensure the path structure matches: `public/_other logos/`

3. **Import and use**
   ```tsx
   import Footer from './components/Footer';
   import Logo from './components/Logo'; // Your project's logo component
   
   function App() {
     return (
       <div>
         {/* Your app content */}
         <Footer 
           logo={<Logo />}
           strapline="Your app description"
         />
       </div>
     );
   }
   ```

## Customization Options

### Basic Usage (with defaults)
```tsx
<Footer logo={<Logo />} strapline="Your app description" />
```

### Custom Projects
```tsx
<Footer 
  logo={<Logo />}
  strapline="Your app description"
  projects={[
    {
      name: "Your Project",
      url: "https://example.com",
      logoDark: "/path/to/logo-dark.svg",
      logoLight: "/path/to/logo-light.svg"
    }
  ]}
/>
```

### Hide Settings Link
```tsx
<Footer 
  logo={<Logo />}
  strapline="Your app description"
  settingsLink={null}
/>
```

### Custom Company Info
```tsx
<Footer 
  logo={<Logo />}
  strapline="Your app description"
  companyName="Your Company Name"
  companyUrl="https://yourcompany.com"
/>
```

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `logo` | `ReactNode` | `undefined` | Your project logo component |
| `strapline` | `string` | `"Creative digital solutions"` | Description text displayed below logo |
| `homeLink` | `string` | `"/"` | Link for the logo/home navigation |
| `settingsLink` | `string \| null` | `"/settings"` | Settings page link (set to `null` to hide) |
| `projects` | `Project[]` | Default 4 projects | Array of project logos to display |
| `companyName` | `string` | `"Deep Design Pty Ltd"` | Company name in copyright |
| `companyUrl` | `string` | `"https://jamescutts.me/"` | Company website URL |

## Project Object Structure

```typescript
interface Project {
  name: string;        // Project name (for aria-label)
  url: string;         // Project URL
  logoDark: string;    // Path to dark mode logo
  logoLight: string;   // Path to light mode logo
}
```

## Dependencies

- React
- React Router (for `Link` component - can be replaced with `<a>` if not using React Router)
- Tailwind CSS (for styling)

## Making it Accessible Across Cursor Projects

### Option 1: Copy to Each Project
Simply copy the `Footer.reusable.tsx` file and logo assets to each new project.

### Option 2: Create a Shared Components Repository
Create a GitHub repository with reusable components and reference it in your projects.

### Option 3: Use Cursor's File Access
Since Cursor can access files across your workspace, you can:
1. Keep this component in a central location
2. Reference it or copy it when needed in new projects

## Notes

- The component automatically detects dark/light mode
- All logos are sized at 40px height
- The component is responsive and works on mobile/tablet/desktop
- All external links open in new tabs with proper security attributes

