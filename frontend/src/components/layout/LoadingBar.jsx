import { useLoading } from '../../context/LoadingContext'

function LoadingBar() {
  const { isLoading } = useLoading()

  if (!isLoading) return null

  return (
    <>
      <div style={{
        position: 'fixed',
        top: 0, left: 0,
        width: '100%',
        height: '3px',
        zIndex: 9999,
        background: 'var(--card-border)',
      }}>
        <div style={{
          height: '100%',
          background: 'var(--accent)',
          animation: 'loadingBar 1.5s ease-in-out infinite',
        }} />
      </div>
      <style>{`
        @keyframes loadingBar {
          0%   { width: 0%;   margin-left: 0; }
          50%  { width: 60%;  margin-left: 20%; }
          100% { width: 0%;   margin-left: 100%; }
        }
      `}</style>
    </>
  )
}

export default LoadingBar