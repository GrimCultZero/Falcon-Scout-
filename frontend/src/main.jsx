import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'

const ZOOM = 1.2

function sizeRoot() {
  const el = document.getElementById('root')
  if (!el) return
  el.style.width  = Math.round(window.innerWidth  / ZOOM) + 'px'
  el.style.height = Math.round(window.innerHeight / ZOOM) + 'px'
}

sizeRoot()
window.addEventListener('resize', sizeRoot)

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
