export function Canvas({ label, className = '', canvasRef, ...props }) {
  return (
    <canvas
      ref={canvasRef}
      aria-label={label}
      className={`block w-full rounded-box ${className}`}
      {...props}
    />
  );
}
