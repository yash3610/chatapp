import Avatar from './Avatar';

const IncomingCallModal = ({ call, onAccept, onReject }) => {
  if (!call) {
    return null;
  }

  const callLabel = call.callType === 'video' ? 'Video call' : 'Audio call';

  return (
    <div className="incoming-call-overlay" role="dialog" aria-modal="true">
      <div className="incoming-call-card neu-raised">
        <p className="incoming-call__subtitle">Incoming {callLabel}</p>
        <Avatar name={call.callerName} src={call.callerAvatar} size="lg" />
        <h3>{call.callerName}</h3>
        <p className="incoming-call__hint">is calling you...</p>

        <div className="incoming-call__actions">
          <button
            type="button"
            className="btn incoming-call__btn incoming-call__btn--reject"
            onClick={onReject}
          >
            Reject
          </button>
          <button
            type="button"
            className="btn incoming-call__btn incoming-call__btn--accept"
            onClick={onAccept}
          >
            Accept
          </button>
        </div>
      </div>
    </div>
  );
};

export default IncomingCallModal;
