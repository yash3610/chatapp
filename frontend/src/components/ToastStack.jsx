const ToastStack = ({ toasts, onDismiss }) => {
  return (
    <div className="toast-stack" role="status" aria-live="polite">
      {toasts.map((toast) => (
        <article key={toast.id} className={`toast toast--${toast.type} neu-raised`}>
          <p>{toast.message}</p>
          <button type="button" className="toast__close" onClick={() => onDismiss(toast.id)}>
            x
          </button>
        </article>
      ))}
    </div>
  );
};

export default ToastStack;
