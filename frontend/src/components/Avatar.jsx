const Avatar = ({ name = 'User', src = '', size = 'md', className = '' }) => {
  const initials = name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');

  const hasImage = typeof src === 'string' && src.trim().length > 0;

  return (
    <span className={`avatar avatar--${size} ${className}`.trim()}>
      {hasImage ? <img src={src} alt={name} className="avatar__image" loading="lazy" /> : initials || 'U'}
    </span>
  );
};

export default Avatar;
