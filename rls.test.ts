// RLS Policy Test - Example using defineTests API
import { defineTests } from 'rls-guard';

export default defineTests({
  name: 'User RLS Policy Tests',
  data: {
    users: [
      { id: 1, user_id: 'user-123', name: 'Alice' },
      { id: 2, user_id: 'user-456', name: 'Bob' }
    ]
  },
  contexts: [
    { user: 'user-123', role: 'authenticated_user' },
    { user: 'user-456', role: 'authenticated_user' },
    { user: 'admin-1', role: 'admin' }
  ],
  policies: [
    {
      name: 'user_isolation',
      table: 'users',
      command: 'SELECT' as const,
      roles: ['authenticated_user'],
      expression: "user_id = current_setting('app.current_user_id')"
    },
    {
      name: 'admin_full_access',
      table: 'users',  
      command: 'SELECT' as const,
      roles: ['admin'],
      expression: 'true'
    }
  ],
  tests: [
    // User can only see their own record
    (expect) => expect('user-123').canSelect('users').rows([
      { id: 1, user_id: 'user-123', name: 'Alice' }
    ]),
    
    // Another user can only see their own record
    (expect) => expect('user-456').canSelect('users').rows([
      { id: 2, user_id: 'user-456', name: 'Bob' }
    ]),
    
    // Admin can see all records  
    (expect) => expect('admin-1').canSelect('users').rows([
      { id: 1, user_id: 'user-123', name: 'Alice' },
      { id: 2, user_id: 'user-456', name: 'Bob' }
    ])
  ]
});