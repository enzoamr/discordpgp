'use strict';

/** Erreur destinée à être montrée telle quelle à l'utilisateur (toast). */
class UserError extends Error {
  constructor(message) {
    super(message);
    this.name = 'UserError';
    this.userFacing = true;
  }
}

module.exports = { UserError };
