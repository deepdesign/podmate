/**
 * Reusable Footer Component for Deep Design Projects
 * 
 * This component can be easily copied to other Cursor/React projects.
 * 
 * Usage:
 * 1. Copy this file to your project's components folder
 * 2. Copy the logo assets from `public/_other logos/` to your project's public folder
 * 3. Import and use: <Footer logo={<YourLogo />} strapline="Your app description" />
 * 
 * Props:
 * - logo: ReactNode - Your project logo component
 * - strapline: string - Description text for your project
 * - homeLink: string - Link for the logo (default: "/")
 * - settingsLink: string - Link for settings (default: "/settings", set to null to hide)
 * - projects: Array of {name, url, logoDark, logoLight} - Project logos to display
 * - companyName: string - Company name for copyright (default: "Deep Design Pty Ltd")
 * - companyUrl: string - Company URL for copyright link (default: "https://jamescutts.me/")
 */

import { useEffect, useState, ReactNode } from 'react';
import { Link } from 'react-router-dom';

interface Project {
  name: string;
  url: string;
  logoDark: string;
  logoLight: string;
}

interface FooterProps {
  logo?: ReactNode;
  strapline?: string;
  homeLink?: string;
  settingsLink?: string | null;
  projects?: Project[];
  companyName?: string;
  companyUrl?: string;
}

export default function Footer({
  logo,
  strapline = "Creative digital solutions",
  homeLink = "/",
  settingsLink = "/settings",
  projects = [
    {
      name: "Renamely",
      url: "https://github.com/deepdesign/renamely",
      logoDark: "/_other logos/renamely-circle-dark.svg",
      logoLight: "/_other logos/renamely-circle-light.svg"
    },
    {
      name: "Podmate",
      url: "https://github.com/deepdesign/podmate",
      logoDark: "/_other logos/podmate-circle-dark.svg",
      logoLight: "/_other logos/podmate-circle-light.svg"
    },
    {
      name: "Walljazzle",
      url: "https://walljazzle.com/",
      logoDark: "/_other logos/walljazzle-circle-dark.svg",
      logoLight: "/_other logos/walljazzle-circle-light.svg"
    },
    {
      name: "Waxvalue",
      url: "https://www.waxvalue.com/",
      logoDark: "/_other logos/waxvalue-circle-dark.svg",
      logoLight: "/_other logos/waxvalue-circle-light.svg"
    }
  ],
  companyName = "Deep Design Pty Ltd",
  companyUrl = "https://jamescutts.me/"
}: FooterProps) {
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    const checkTheme = () => {
      const isDarkMode =
        document.documentElement.classList.contains('dark') ||
        localStorage.getItem('color-theme') === 'dark' ||
        (!('color-theme' in localStorage) &&
          window.matchMedia('(prefers-color-scheme: dark)').matches);
      setIsDark(isDarkMode);
    };

    checkTheme();

    const observer = new MutationObserver(() => {
      checkTheme();
    });

    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    });

    return () => {
      observer.disconnect();
    };
  }, []);

  return (
    <footer className="bg-white rounded-lg shadow-sm m-4 dark:bg-gray-900">
      <div className="w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 md:py-8">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-8">
          {/* Logo and Strapline */}
          {logo && (
            <div>
              <Link to={homeLink} className="flex items-center mb-4">
                {logo}
              </Link>
              {strapline && (
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  {strapline}
                </p>
              )}
            </div>
          )}

          {/* Projects Section */}
          {projects.length > 0 && (
            <div>
              <h2 className="mb-4 text-sm font-semibold text-gray-900 uppercase dark:text-white">
                Projects
              </h2>
              <ul className="flex flex-wrap gap-4 items-center">
                {projects.map((project) => (
                  <li key={project.name}>
                    <a
                      href={project.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white transition-colors"
                      aria-label={project.name}
                    >
                      <img
                        src={isDark ? project.logoDark : project.logoLight}
                        alt={project.name}
                        className="h-[40px] w-auto opacity-100 hover:opacity-70 transition-opacity"
                      />
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Contact Section */}
          <div>
            <h2 className="mb-4 text-sm font-semibold text-gray-900 uppercase dark:text-white">
              Contact
            </h2>
            <ul className="flex flex-wrap gap-4 items-center">
              <li>
                <a
                  href={companyUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white transition-colors"
                  aria-label="JC Logo"
                >
                  <img
                    src={isDark ? '/_other logos/jc-logo-dark.svg' : '/_other logos/jc-logo-light.svg'}
                    alt="JC"
                    className="h-[40px] w-auto opacity-100 hover:opacity-70 transition-opacity"
                  />
                </a>
              </li>
              <li>
                <a
                  href="https://github.com/deepdesign"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white transition-colors"
                  aria-label="GitHub"
                >
                  <img
                    src={isDark ? '/_other logos/github-mark-dark.svg' : '/_other logos/github-mark-light.svg'}
                    alt="GitHub"
                    className="h-[40px] w-auto opacity-100 hover:opacity-70 transition-opacity"
                  />
                </a>
              </li>
            </ul>
          </div>
        </div>

        {/* Divider and Copyright */}
        <hr className="my-6 border-gray-200 sm:mx-auto dark:border-gray-700 lg:my-8" />
        <div className="sm:flex sm:items-center sm:justify-between">
          <span className="text-sm text-gray-500 sm:text-center dark:text-gray-400">
            © {new Date().getFullYear()}{' '}
            <a
              href={companyUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:underline"
            >
              {companyName}
            </a>
            . All Rights Reserved.
          </span>
          {settingsLink && (
            <div className="flex mt-4 sm:justify-center sm:mt-0">
              <ul className="flex flex-wrap items-center gap-4 text-sm font-medium text-gray-500 dark:text-gray-400">
                <li>
                  <Link to={settingsLink} className="hover:underline">
                    Settings
                  </Link>
                </li>
              </ul>
            </div>
          )}
        </div>
      </div>
    </footer>
  );
}

