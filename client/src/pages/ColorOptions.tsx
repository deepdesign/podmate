import { useState } from 'react';

// Brand color: #21e8cf
const brandColor = '#21e8cf';

// Color theory options
const colorOptions = [
  {
    name: 'Monochromatic (Dark)',
    description: 'Darker shade of the same color',
    gradient: {
      from: '#21e8cf',
      via: '#18c4b0',
      to: '#0fa892',
    },
    theory: 'Monochromatic colors are variations of the same hue with different saturation/lightness',
  },
  {
    name: 'Monochromatic (Light)',
    description: 'Lighter variations',
    gradient: {
      from: '#4df2dd',
      via: '#21e8cf',
      to: '#0fa892',
    },
    theory: 'Lighter to darker monochromatic gradient',
  },
  {
    name: 'Complementary',
    description: 'Opposite on color wheel (warm contrast)',
    gradient: {
      from: '#21e8cf',
      via: '#1dd5c4',
      to: '#ff6b4a',
    },
    theory: 'Complementary colors are opposite on the color wheel - creates high contrast',
  },
  {
    name: 'Split-Complementary',
    description: 'Complementary with adjacent colors',
    gradient: {
      from: '#21e8cf',
      via: '#1dd5c4',
      to: '#ff8c42',
    },
    theory: 'Uses the base color and two colors adjacent to its complement',
  },
  {
    name: 'Analogous (Blue-Green)',
    description: 'Adjacent colors on color wheel',
    gradient: {
      from: '#0ea5e9',
      via: '#21e8cf',
      to: '#10b981',
    },
    theory: 'Analogous colors sit next to each other - creates harmony',
  },
  {
    name: 'Triadic',
    description: '120 degrees apart on color wheel',
    gradient: {
      from: '#21e8cf',
      via: '#e921cf',
      to: '#cfe921',
    },
    theory: 'Triadic colors are evenly spaced on the color wheel',
  },
  {
    name: 'Blue Accent (Current)',
    description: 'Blue-teal combination',
    gradient: {
      from: '#21e8cf',
      via: '#18c4b0',
      to: '#0ea5e9',
    },
    theory: 'Teal to blue gradient - cool color harmony',
  },
  {
    name: 'Teal-Purple',
    description: 'Teal to purple transition',
    gradient: {
      from: '#21e8cf',
      via: '#1dd5c4',
      to: '#8b5cf6',
    },
    theory: 'Cool color harmony with purple accent',
  },
];

export default function ColorOptions() {
  const [selectedOption, setSelectedOption] = useState<number | null>(null);

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-7xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">
            Brand Color Gradient Options
          </h1>
          <p className="text-gray-600 dark:text-gray-400">
            Brand Color: <span className="font-mono text-brand">{brandColor}</span>
          </p>
          <p className="text-sm text-gray-500 dark:text-gray-500 mt-2">
            Click on any option to see button examples below
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-12">
          {colorOptions.map((option, index) => (
            <div
              key={index}
              onClick={() => setSelectedOption(index)}
              className={`p-6 bg-white dark:bg-gray-800 rounded-lg shadow cursor-pointer border-2 transition-all ${
                selectedOption === index
                  ? 'border-brand ring-2 ring-brand/20'
                  : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
              }`}
            >
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
                {option.name}
              </h3>
              <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
                {option.description}
              </p>
              
              {/* Color preview */}
              <div className="mb-3 flex items-center gap-2">
                <div
                  className="h-12 flex-1 rounded"
                  style={{
                    background: `linear-gradient(to right, ${option.gradient.from}, ${option.gradient.via || option.gradient.from}, ${option.gradient.to})`,
                  }}
                />
              </div>
              
              <div className="text-xs text-gray-500 dark:text-gray-500 space-y-1 mb-3">
                <div>
                  From: <span className="font-mono">{option.gradient.from}</span>
                </div>
                {option.gradient.via && (
                  <div>
                    Via: <span className="font-mono">{option.gradient.via}</span>
                  </div>
                )}
                <div>
                  To: <span className="font-mono">{option.gradient.to}</span>
                </div>
              </div>
              
              <p className="text-xs text-gray-500 dark:text-gray-500 italic">
                {option.theory}
              </p>
            </div>
          ))}
        </div>

        {/* Button Examples */}
        {selectedOption !== null && (
          <div className="mt-12 bg-white dark:bg-gray-800 rounded-lg shadow-lg p-8">
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-6">
              Button Examples: {colorOptions[selectedOption].name}
            </h2>
            
            <div className="space-y-6">
              {/* Primary Buttons */}
              <div>
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                  Primary Buttons
                </h3>
                <div className="flex flex-wrap gap-4">
                  <button
                    className="text-white font-medium rounded-lg text-sm px-5 py-2.5 text-center transition-all focus:outline-none focus:ring-4 hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
                    style={{
                      background: `linear-gradient(to right, ${colorOptions[selectedOption].gradient.from}, ${colorOptions[selectedOption].gradient.via || colorOptions[selectedOption].gradient.from}, ${colorOptions[selectedOption].gradient.to})`,
                    }}
                    onFocus={(e) => {
                      e.currentTarget.style.boxShadow = `0 0 0 4px ${colorOptions[selectedOption].gradient.from}4d`;
                    }}
                    onBlur={(e) => {
                      e.currentTarget.style.boxShadow = '';
                    }}
                    onMouseEnter={(e) => {
                      const from = colorOptions[selectedOption].gradient.from;
                      const via = colorOptions[selectedOption].gradient.via || from;
                      const to = colorOptions[selectedOption].gradient.to;
                      e.currentTarget.style.background = `linear-gradient(to bottom right, ${from}, ${via}, ${to})`;
                    }}
                    onMouseLeave={(e) => {
                      const from = colorOptions[selectedOption].gradient.from;
                      const via = colorOptions[selectedOption].gradient.via || from;
                      const to = colorOptions[selectedOption].gradient.to;
                      e.currentTarget.style.background = `linear-gradient(to right, ${from}, ${via}, ${to})`;
                    }}
                  >
                    Next →
                  </button>
                  
                  <button
                    className="text-white font-medium rounded-lg text-sm px-5 py-2.5 text-center disabled:opacity-50 disabled:cursor-not-allowed"
                    style={{
                      background: `linear-gradient(to right, ${colorOptions[selectedOption].gradient.from}, ${colorOptions[selectedOption].gradient.via || colorOptions[selectedOption].gradient.from}, ${colorOptions[selectedOption].gradient.to})`,
                    }}
                    disabled
                  >
                    Disabled Button
                  </button>
                  
                  <button
                    className="text-white font-medium rounded-lg text-sm px-4 py-2 text-center transition-all focus:outline-none focus:ring-4 hover:opacity-90"
                    style={{
                      background: `linear-gradient(to right, ${colorOptions[selectedOption].gradient.from}, ${colorOptions[selectedOption].gradient.via || colorOptions[selectedOption].gradient.from}, ${colorOptions[selectedOption].gradient.to})`,
                    }}
                    onFocus={(e) => {
                      e.currentTarget.style.boxShadow = `0 0 0 4px ${colorOptions[selectedOption].gradient.from}4d`;
                    }}
                    onBlur={(e) => {
                      e.currentTarget.style.boxShadow = '';
                    }}
                    onMouseEnter={(e) => {
                      const from = colorOptions[selectedOption].gradient.from;
                      const via = colorOptions[selectedOption].gradient.via || from;
                      const to = colorOptions[selectedOption].gradient.to;
                      e.currentTarget.style.background = `linear-gradient(to bottom right, ${from}, ${via}, ${to})`;
                    }}
                    onMouseLeave={(e) => {
                      const from = colorOptions[selectedOption].gradient.from;
                      const via = colorOptions[selectedOption].gradient.via || from;
                      const to = colorOptions[selectedOption].gradient.to;
                      e.currentTarget.style.background = `linear-gradient(to right, ${from}, ${via}, ${to})`;
                    }}
                  >
                    Check Status
                  </button>
                  
                  <button
                    className="text-white font-medium rounded-lg text-sm px-5 py-2.5 text-center transition-all focus:outline-none focus:ring-4 hover:opacity-90"
                    style={{
                      background: `linear-gradient(to right, ${colorOptions[selectedOption].gradient.from}, ${colorOptions[selectedOption].gradient.via || colorOptions[selectedOption].gradient.from}, ${colorOptions[selectedOption].gradient.to})`,
                    }}
                    onFocus={(e) => {
                      e.currentTarget.style.boxShadow = `0 0 0 4px ${colorOptions[selectedOption].gradient.from}4d`;
                    }}
                    onBlur={(e) => {
                      e.currentTarget.style.boxShadow = '';
                    }}
                    onMouseEnter={(e) => {
                      const from = colorOptions[selectedOption].gradient.from;
                      const via = colorOptions[selectedOption].gradient.via || from;
                      const to = colorOptions[selectedOption].gradient.to;
                      e.currentTarget.style.background = `linear-gradient(to bottom right, ${from}, ${via}, ${to})`;
                    }}
                    onMouseLeave={(e) => {
                      const from = colorOptions[selectedOption].gradient.from;
                      const via = colorOptions[selectedOption].gradient.via || from;
                      const to = colorOptions[selectedOption].gradient.to;
                      e.currentTarget.style.background = `linear-gradient(to right, ${from}, ${via}, ${to})`;
                    }}
                  >
                    Upload to Gelato
                  </button>
                  
                  <button
                    className="text-white font-medium rounded-lg text-sm px-4 py-2 text-center transition-all focus:outline-none focus:ring-4 hover:opacity-90"
                    style={{
                      background: `linear-gradient(to right, ${colorOptions[selectedOption].gradient.from}, ${colorOptions[selectedOption].gradient.via || colorOptions[selectedOption].gradient.from}, ${colorOptions[selectedOption].gradient.to})`,
                    }}
                    onFocus={(e) => {
                      e.currentTarget.style.boxShadow = `0 0 0 4px ${colorOptions[selectedOption].gradient.from}4d`;
                    }}
                    onBlur={(e) => {
                      e.currentTarget.style.boxShadow = '';
                    }}
                    onMouseEnter={(e) => {
                      const from = colorOptions[selectedOption].gradient.from;
                      const via = colorOptions[selectedOption].gradient.via || from;
                      const to = colorOptions[selectedOption].gradient.to;
                      e.currentTarget.style.background = `linear-gradient(to bottom right, ${from}, ${via}, ${to})`;
                    }}
                    onMouseLeave={(e) => {
                      const from = colorOptions[selectedOption].gradient.from;
                      const via = colorOptions[selectedOption].gradient.via || from;
                      const to = colorOptions[selectedOption].gradient.to;
                      e.currentTarget.style.background = `linear-gradient(to right, ${from}, ${via}, ${to})`;
                    }}
                  >
                    Retry
                  </button>
                </div>
              </div>

              {/* Code Example */}
              <div className="mt-8">
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                  Tailwind Config
                </h3>
                <div className="bg-gray-900 dark:bg-gray-950 rounded-lg p-4 overflow-x-auto">
                  <pre className="text-sm text-gray-100">
{`colors: {
  brand: {
    DEFAULT: '${colorOptions[selectedOption].gradient.from}',
    dark: '${colorOptions[selectedOption].gradient.via || colorOptions[selectedOption].gradient.from}',
    accent: '${colorOptions[selectedOption].gradient.to}',
  },
},`}
                  </pre>
                </div>
              </div>

              {/* CSS Gradient Code */}
              <div className="mt-4">
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                  Gradient Classes
                </h3>
                <div className="bg-gray-900 dark:bg-gray-950 rounded-lg p-4 overflow-x-auto">
                  <pre className="text-sm text-gray-100">
{`bg-gradient-to-r from-[${colorOptions[selectedOption].gradient.from}] ${colorOptions[selectedOption].gradient.via ? `via-[${colorOptions[selectedOption].gradient.via}]` : ''} to-[${colorOptions[selectedOption].gradient.to}]`}
                  </pre>
                </div>
              </div>
            </div>
          </div>
        )}

        {selectedOption === null && (
          <div className="text-center py-12 bg-white dark:bg-gray-800 rounded-lg shadow">
            <p className="text-gray-600 dark:text-gray-400">
              Select a color option above to see button examples
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
