const bcrypt = require("bcrypt");

const plainPassword = "2PXQUz|Gy4WM6yYo";
const hash = "$2b$10$dwsCsRPwV9FvRKKcbm400unYtBiO0PN/g2In4mfDDOtKemiJpSqya";
async function f() {
const hashedPassword = await bcrypt.hash(plainPassword, 10);
console.log("Hashed Password:", hashedPassword);
} 
bcrypt.hash("2PXQUz|Gy4WM6yYo", 10, (err, newHash) => {
    console.log("New hash:", newHash);
  });
f().catch(console.error);
bcrypt.compare(plainPassword, hash, (err, result) => {
  console.log("Comparison Result:", result); // Should be true if they match
});