import { Routes, Route, Link } from 'react-router-dom';
import Home from './pages/Home';
import Settings from './pages/Settings';
import ColorOptions from './pages/ColorOptions';
import DarkModeToggle from './components/DarkModeToggle';
import Logo from './components/Logo';
import Footer from './components/Footer';

function App() {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex flex-col">
      <nav className="bg-white dark:bg-gray-800 shadow-sm border-b border-gray-200 dark:border-gray-700">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16">
            <div className="flex items-center">
              <Link to="/" className="flex items-center" aria-label="Podmate Home">
                <Logo />
              </Link>
            </div>
            <div className="flex items-center gap-4">
              <DarkModeToggle />
            </div>
          </div>
        </div>
      </nav>
      
      <main className="flex-1 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 w-full">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/color-options" element={<ColorOptions />} />
        </Routes>
      </main>
      
      <Footer 
        logo={<Logo />}
        strapline="Bulk product upload for Gelato"
        settingsLink={null}
      />
    </div>
  );
}

export default App;

