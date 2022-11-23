const defaultTheme = require('tailwindcss/defaultTheme')
const colors = require('tailwindcss/colors')

module.exports = {
    content: ["./src/**/*.{js,jsx,ts,tsx}", "./public/index.html"],
    mode: 'jit',
    purge: [
        "./src/**/*.{js,jsx,ts,tsx}",
        "./public/index.html"
    ],
    theme: {
        fontFamily: {
            sans: ['VT323', 'sans-serif'],
            header: ['PressStart2P', 'sans-serif'],
        },
        screens: {
            'xs': '475px',

            'sm': '700px',

            'md': '840px',

            'lg': '1100px',

            'xl': '1400px',

            '2xl': '1600px',
        },
        extend: {
            colors: {
                primary: '#94e448',
                secondary: '#9848e4',
                background: '#101010',
                accent: '#426621',
                widget: '#1c1c1c',
                disabled: '#919191',
                exclusive: '#A3DBFF',
                acolyte: '#FC9191',
                incinerator: '#F44343',
                pyro: '#FB6D00',
                scorcher: '#F4A133',
            },
        },
    },
    plugins: [],
};
