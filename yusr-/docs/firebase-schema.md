# مخطط Firestore المقترح

## users/{userId}

```json
{
  "name": "د. أمين",
  "email": "teacher@example.com",
  "role": "teacher",
  "language": "ar",
  "theme": "system",
  "createdAt": "serverTimestamp",
  "updatedAt": "serverTimestamp"
}
```

## subjects/{subjectId}

```json
{
  "ownerId": "userId",
  "name": "برمجة",
  "code": "CS101",
  "room": "قاعة 204",
  "absenceLimit": 6,
  "attendanceMode": "buttons",
  "autoPresent": true,
  "createdAt": "serverTimestamp",
  "updatedAt": "serverTimestamp"
}
```

## subjects/{subjectId}/students/{studentId}

```json
{
  "name": "أحمد خالد",
  "universityId": "440001",
  "absenceCount": 2,
  "lateCount": 1,
  "notes": "",
  "createdAt": "serverTimestamp",
  "updatedAt": "serverTimestamp"
}
```

## subjects/{subjectId}/attendanceSessions/{sessionId}

```json
{
  "date": "2026-05-18",
  "createdBy": "userId",
  "statusMap": {
    "studentId": "present"
  },
  "syncedAt": "serverTimestamp"
}
```

القيم المدعومة للحالة:

```text
present
absent
late
```

## subjects/{subjectId}/gradeColumns/{columnId}

```json
{
  "label": "الشفوي",
  "max": 10,
  "order": 1
}
```

## subjects/{subjectId}/grades/{studentId}

```json
{
  "oral": 8,
  "homework": 14,
  "monthly": 18,
  "behavior": 5,
  "final": 44,
  "updatedAt": "serverTimestamp"
}
```

## قواعد أمان Firestore مبدئية

```js
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    function signedIn() {
      return request.auth != null;
    }

    match /users/{userId} {
      allow read, write: if signedIn() && request.auth.uid == userId;
    }

    match /subjects/{subjectId} {
      allow read, write: if signedIn() && resource.data.ownerId == request.auth.uid;
      allow create: if signedIn() && request.resource.data.ownerId == request.auth.uid;

      match /{subCollection}/{docId} {
        allow read, write: if signedIn() &&
          get(/databases/$(database)/documents/subjects/$(subjectId)).data.ownerId == request.auth.uid;
      }
    }
  }
}
```
