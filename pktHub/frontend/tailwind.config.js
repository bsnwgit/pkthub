/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        suite: {
          bg: '#0a1628',
          surface: '#111827',
          border: '#1f2937',
          flow: '#60a5fa',
          snmp: '#2dd4bf',
          log: '#4ade80',
          pcap: '#a78bfa',
        }
      }
    }
  },
  plugins: [],
}
