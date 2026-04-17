const OutgoingCallModal = ({ call, onCancel }) => {
  if (!call) {
    return null;
  }

  const callLabel = call.callType === 'video' ? 'Video call' : 'Audio call';

  return (
    <div className="outgoing-call-overlay" role="status" aria-live="polite">
      <div className="outgoing-call-card neu-raised">
        <p className="outgoing-call__subtitle">{callLabel}</p>
        <h3>{call.peerName}</h3>
        <p className="outgoing-call__status">{call.statusText || 'Calling...'}</p>

        {call.showCancel !== false && (
          <button type="button" className="btn outgoing-call__cancel" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
    </div>
  );
};

export default OutgoingCallModal;
