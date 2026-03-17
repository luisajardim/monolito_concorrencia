process.env.DB_PATH = ':memory:';
process.env.JWT_SECRET = 'test-secret';

const request = require('supertest');
const app = require('../server');
const database = require('../database/database');

async function registerAndLogin() {
    const userPayload = {
        email: 'user@test.com',
        username: 'testuser',
        password: '123456',
        firstName: 'Joao',
        lastName: 'Silva'
    };

    await request(app).post('/api/auth/register').send(userPayload).expect(201);
    const loginRes = await request(app)
        .post('/api/auth/login')
        .send({ identifier: userPayload.email, password: userPayload.password })
        .expect(200);

    return loginRes.body.data.token;
}

describe('API tradicional', () => {
    beforeAll(async () => {
        await database.init();
    });

    beforeEach(async () => {
        await database.clearTables();
    });

    afterAll(async () => {
        await database.close();
    });

    it('registra e autentica usuário', async () => {
        const token = await registerAndLogin();
        expect(token).toBeTruthy();
    });

    it('retorna usuário atual em /api/users/me', async () => {
        const token = await registerAndLogin();

        const res = await request(app)
            .get('/api/users/me')
            .set('Authorization', `Bearer ${token}`)
            .expect(200);

        expect(res.body.data).toMatchObject({ email: 'user@test.com', username: 'testuser' });
    });

    it('cria e lista tarefas autenticadas', async () => {
        const token = await registerAndLogin();

        await request(app)
            .post('/api/tasks')
            .set('Authorization', `Bearer ${token}`)
            .send({ title: 'Minha Tarefa', description: 'Descrição', priority: 'high' })
            .expect(201);

        const listRes = await request(app)
            .get('/api/tasks')
            .set('Authorization', `Bearer ${token}`)
            .expect(200);

        expect(Array.isArray(listRes.body.data)).toBe(true);
        expect(listRes.body.data.length).toBe(1);
        expect(listRes.body.data[0]).toMatchObject({ title: 'Minha Tarefa', priority: 'high' });
    });
});
