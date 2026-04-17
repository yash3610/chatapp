import { useEffect, useRef, useState } from 'react';

const MessageInput = ({ disabled, onSend, onTypingStart, onTypingStop, isUploadingImage }) => {
  const [text, setText] = useState('');
  const [selectedFile, setSelectedFile] = useState(null);
  const typingTimeoutRef = useRef(null);
  const fileInputRef = useRef(null);

  useEffect(() => {
    return () => {
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
      }
    };
  }, []);

  const handleChange = (event) => {
    const nextText = event.target.value;
    setText(nextText);

    onTypingStart();

    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }

    // Stop typing indicator if user pauses for 800ms.
    typingTimeoutRef.current = setTimeout(() => {
      onTypingStop();
    }, 800);
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

    const trimmed = text.trim();
    if ((!trimmed && !selectedFile) || disabled) {
      return;
    }

    const sent = await onSend(trimmed, selectedFile);
    if (sent) {
      setText('');
      setSelectedFile(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
      onTypingStop();
    }
  };

  const handlePickImage = () => {
    if (disabled || isUploadingImage) {
      return;
    }
    fileInputRef.current?.click();
  };

  const handleImageChange = async (event) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    setSelectedFile(file);
  };

  return (
    <form className="message-input neu-raised" onSubmit={handleSubmit}>
      <input ref={fileInputRef} type="file" accept="image/*" hidden onChange={handleImageChange} />
      <button
        className={`btn btn--ghost neu-button message-input__attach ${selectedFile ? 'message-input__attach--active' : ''}`}
        type="button"
        onClick={handlePickImage}
        disabled={disabled || isUploadingImage}
        title="Attach image"
        aria-label="Attach image"
      >
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <path
            d="M16.5 6.5a4 4 0 0 0-5.7 0l-6 6a5 5 0 1 0 7.1 7.1l5.6-5.6a3 3 0 1 0-4.2-4.2l-5.3 5.3a1 1 0 1 0 1.4 1.4l4.9-4.9"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      <input
        type="text"
        placeholder={disabled ? 'Select a user to chat' : selectedFile ? 'Add description (optional)...' : 'Type a message...'}
        value={text}
        onChange={handleChange}
        disabled={disabled}
      />
      <button
        className="btn btn--primary neu-button"
        type="submit"
        disabled={disabled || (!text.trim() && !selectedFile) || isUploadingImage}
      >
        {isUploadingImage ? 'Uploading...' : 'Send'}
      </button>
    </form>
  );
};

export default MessageInput;
