import multer from 'multer';

const storage = multer.memoryStorage();

const imageFilter = (_req, file, cb) => {
  if (!file.mimetype.startsWith('image/')) {
    return cb(new Error('Only image files are allowed'));
  }
  return cb(null, true);
};

const attachmentFilter = (_req, file, cb) => {
  if (file.mimetype.startsWith('image/')) {
    return cb(null, true);
  }

  const allowedDocs = [
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ];

  if (allowedDocs.includes(file.mimetype)) {
    return cb(null, true);
  }

  return cb(new Error('Only images or documents are allowed'));
};

export const uploadImage = multer({
  storage,
  fileFilter: imageFilter,
  limits: {
    fileSize: 5 * 1024 * 1024,
  },
});

export const uploadAttachment = multer({
  storage,
  fileFilter: attachmentFilter,
  limits: {
    fileSize: 12 * 1024 * 1024,
  },
});
