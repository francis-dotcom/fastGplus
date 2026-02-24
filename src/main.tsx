import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import Programs from './Programs'

const rootEl = document.getElementById('programs-root')
if (rootEl) {
  createRoot(rootEl).render(
    <StrictMode>
      <Programs />
    </StrictMode>
  )
}
