// scripts/hash-password.js — genera el hash de la contraseña del panel
// Uso:  npm run hash -- "mi-contraseña-segura"
const bcrypt = require('bcryptjs');
const pw = process.argv[2];
if (!pw) {
  console.error('Uso: npm run hash -- "tu-contraseña"');
  process.exit(1);
}
console.log('\nADMIN_PASS_HASH=' + bcrypt.hashSync(pw, 10) + '\n');
console.log('Copia esa línea en tu archivo .env\n');
