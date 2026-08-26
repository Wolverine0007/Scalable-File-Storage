const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const db = require("../config/db");

async function registerUser(name, email, password) {
    // Check if email already exists
    const [existingUsers] = await db.execute(
        "SELECT id FROM users WHERE email = ?",
        [email]
    );

    if (existingUsers.length > 0) {
        throw new Error("Email already registered");
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 12);

    // Insert user
    const [result] = await db.execute(
        `INSERT INTO users
        (name, email, password_hash)
        VALUES (?, ?, ?)`,
        [name, email, passwordHash]
    );

    return {
        id: result.insertId,
        name,
        email
    };
}

async function loginUser(email, password) {
    const [users] = await db.execute(
        `SELECT id, name, email, password_hash
         FROM users
         WHERE email = ?`,
        [email]
    );

    if (users.length === 0) {
        throw new Error("Invalid email or password");
    }

    const user = users[0];

    const passwordMatch = await bcrypt.compare(
        password,
        user.password_hash
    );

    if (!passwordMatch) {
        throw new Error("Invalid email or password");
    }

    const token = jwt.sign(
        {
            userId: user.id,
            email: user.email
        },
        process.env.JWT_SECRET,
        {
            expiresIn: process.env.JWT_EXPIRES_IN || "1h"
        }
    );

    return {
        token,
        user: {
            id: user.id,
            name: user.name,
            email: user.email
        }
    };
}

module.exports = {
    registerUser,
    loginUser
};