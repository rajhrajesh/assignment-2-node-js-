const express = require('express')
const path = require('path')
const {open} = require('sqlite')
const sqlite3 = require('sqlite3')
const dbPath = path.join(__dirname, 'twitterClone.db')
const app = express()

app.use(express.json())
const bcrypt = require('bcrypt')
const jwt = require('jsonwebtoken')
let db = null

const initializeDBAndServer = async () => {
  try {
    db = await open({filename: dbPath, driver: sqlite3.Database})
    app.listen(3000, () => {
      console.log('Server Running at http://localhost:3000/')
    })
  } catch (e) {
    console.log('DB Error: ${e.message}')
  }
}
initializeDBAndServer()

const validatePassword = password => {
  return password.length >= 6
}

//API -1 POST Register

app.post('/register/', async (request, response) => {
  const {username, password, name, gender} = request.body
  const getUserQuery = `
  SELECT * FROM user WHERE username = '${username}';
  `
  const dbUser = await db.get(getUserQuery)
  if (dbUser === undefined) {
    if (validatePassword(password)) {
      const hashedPassword = await bcrypt.hash(password, 10)
      const createUserQuery = `
      INSERT INTO user(username, password, name, gender)
      VALUES('${username}', '${hashedPassword}', '${name}', '${gender}');
      `
      await db.run(createUserQuery)
      response.status(200)
      response.send('User created successfully')
    } else {
      response.status(400)
      response.send('Password is too short')
    }
  } else {
    response.status(400)
    response.send('User already exists')
  }
})

//API -2 Login

app.post('/login/', async (request, response) => {
  let jwtToken
  const {username, password} = request.body
  const selectUserQuery = `
  SELECT * FROM user WHERE username = '${username}';
  `
  const dbUser = await db.get(selectUserQuery)
  if (dbUser !== undefined) {
    const isPasswordMatch = await bcrypt.compare(password, dbUser.password)
    if (isPasswordMatch) {
      jwtToken = jwt.sign(username, 'Roll.no_ 22')
      response.send({jwtToken})
    } else {
      response.status(400)
      response.send('Invalid password')
    }
  } else {
    response.status(400)
    response.send('Invalid user')
  }
})

const authentication = (request, response, next) => {
  let jwtToken
  const authorization = request.headers['authorization']
  if (authorization !== undefined) {
    jwtToken = authorization.split(' ')[1]
  }
  if (jwtToken === undefined) {
    response.status(401)
    response.send('Invalid JWT Token')
  } else {
    jwt.verify(jwtToken, 'Roll.no_ 22', async (error, payload) => {
      if (error) {
        response.status(401)
        response.send('Invalid JWT Token')
      } else {
        request.username = payload
        next()
      }
    })
  }
}

const tweetResponse = dbObject => ({
  username: dbObject.username,
  tweet: dbObject.tweet,
  dateTime: dbObject.date_time,
})

//API -3 Get User/Tweets/Feed

app.get('/user/tweets/feed/', authentication, async (request, response) => {
  const getuserResponse = `
  
  SELECT tweet.tweet_id, tweet.user_id, user.username, tweet.tweet, tweet.date_time 
  FROM follower LEFT JOIN tweet ON tweet.user_id = follower.following_user_id
  LEFT JOIN user ON follower.following_user_id = user.user_id
  WHERE follower.following_user_id = (SELECT user_id from user WHERE username = '${request.username}')
  ORDER BY tweet.date_time DESC LIMIT 4;
  `
  const userFeed = await db.all(getuserResponse)
  response.send(userFeed.map(item => tweetResponse(item)))
})

//API -4 GET
app.get('/user/following/', authentication, async (request, response) => {
  const getUserFollowing = `
  
  SELECT user.name
  FROM follower 
  LEFT JOIN user ON follower.following_user_id = user.user_id
  WHERE follower.follower_user_id = (SELECT user_id FROM user WHERE username = '${request.username}');
  `
  const followUser = await db.all(getUserFollowing)
  response.send(followUser)
})

//API -5 GET
app.get('/user/followers/', authentication, async (request, response) => {
  const getUserFollower = `
  
  SELECT user.name
  FROM follower 
  LEFT JOIN user ON follower.follower_user_id = user.user_id
  WHERE follower.following_user_id = (SELECT user_id FROM user WHERE username = '${request.username}');
  `
  const followers = await db.all(getUserFollower)
  response.send(followers)
})

//Follows
const followsDetails = async (request, response, next) => {
  let isFollowing
  const {tweetId} = request.params

  const getTweetId = `
  
  SELECT * FROM follower 
  WHERE follower_user_id = (SELECT user_id FROM user WHERE username = '${request.username}')
  AND following_user_id = (SELECT user.user_id FROM tweet NATURAL JOIN user WHERE tweet_id = ${tweetId});
  `
  isFollowing = await db.get(getTweetId)

  if (isFollowing === undefined) {
    response.status(401)
    response.send('Invalid Request')
  } else {
    next()
  }
}

//API -6 GET
app.get(
  '/tweets/:tweetId/',
  authentication,
  followsDetails,
  async (request, response) => {
    const {tweetId} = request.params
    const {tweet, date_time} = await db.get(
      `SELECT tweet, date_time FROM tweet 
  WHERE tweet_id = ${tweetId};`,
    )
    const {likes} = await db.get(`
      SELECT COUNT(like_id) AS likes FROM like WHERE tweet_id = ${tweetId};
    `)
    const {replies} = await db.get(`
      SELECT COUNT(reply_id) AS replies FROM reply WHERE tweet_id = ${tweetId};
    `)
    response.send({
      tweet,
      likes,
      replies,
      dateTime: date_time,
    })
  },
)

//API -7 GET
app.get(
  '/tweets/:tweetId/likes/',
  authentication,
  followsDetails,
  async (request, response) => {
    const {tweetId} = request.params
    const getTweetLikeQuery = `
  
  SELECT user.username FROM like NATURAL JOIN user WHERE tweet_id = ${tweetId};
  `

    const likeUser = await db.all(getTweetLikeQuery)
    response.send({likes: likeUser.map(item => item.username)})
  },
)

//API -8 GET
app.get(
  '/tweets/:tweetId/replies/',
  authentication,
  followsDetails,
  async (request, response) => {
    const {tweetId} = request.params
    const getUserReplyQuries = `
  
  SELECT user.name, reply.reply FROM reply NATURAL JOIN user WHERE tweet_id = ${tweetId};
  `
    const userReplyDetails = await db.all(getUserReplyQuries)
    response.send({userReplyDetails})
  },
)

//API -9 GET
app.get('/user/tweets/', authentication, async (request, response) => {
  const getTweetsQuery = `
  SELECT tweet.tweet, 
  COUNT(distinct like.like_id) AS likes,
  COUNT(distinct reply.reply_id) AS replies,
  tweet.date_time 
  FROM tweet 
  LEFT JOIN like ON tweet.tweet_id = like.tweet_id
  LEFT JOIN reply ON tweet.tweet_id = reply.tweet_id
  WHERE tweet.user_id = (SELECT user_id FROM user WHERE username ='${request.username}')
  GROUP BY tweet.tweet_id;
  `
  const tweetsDetails = await db.all(getTweetsQuery)
  response.send(
    tweetsDetails.map(item => {
      const {date_time, ...rest} = item
      return {...rest, dateTime: date_time}
    }),
  )
})

//API - 10 POST
app.post('/user/tweets/', authentication, async (request, response) => {
  const {tweet} = request.body
  const selectUserQuery = `
  
  SELECT user_id FROM user WHERE username = '${request.username}';
  `
  const tweetUserDetails = await db.get(selectUserQuery)
  const createUserQuery = `
  
  INSERT INTO tweet(tweet, user_id)
  VALUES('${tweet}', ${tweetUserDetails});
  `
  response.send('Created a Tweet')
})

//API -11
app.delete('/tweets/:tweetId/', authentication, async (request, response) => {
  const {tweetId} = request.params
  const selectDeleteQuery = `
  
  SELECT tweet_id, user_id FROM tweet WHERE tweet_id = ${tweetId} AND 
  user_id = (SELECT user_id FROM user WHERE username = '${request.username}'); 
  `
  const selectUserDetails = await db.get(selectDeleteQuery)

  if (selectUserDetails === undefined) {
    response.status(401)
    response.send('Invalid Request')
  } else {
    const deleteUserQuery = `
    
    DELETE FROM tweet WHERE tweet_id = ${tweetId}
    `
  }
  response.send('Tweet Removed')
})

module.exports = app
