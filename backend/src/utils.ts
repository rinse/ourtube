import fs from 'fs';

export class IllegalArgumentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export async function unlink(path: string): Promise<void> {
  return new Promise((resolve, reject) => {
    fs.unlink(path, err => err == null ? resolve() : reject(err));
  });
}
