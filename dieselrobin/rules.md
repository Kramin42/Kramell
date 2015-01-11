# DieselRobin

**Summary**

Teams of players are assigned race/class combinations (multiple combos per team)
and team members take turns completing "Missions" with each character (e.g., D
to Lair, Lair:1-8). The competition will be run on the freenode IRC channel [##dieselrobin](https://webchat.freenode.net/?channels=##dieselrobin).

*Game Version:* Trunk

**Servers**

* [CAO](http://crawl.akrasiac.org)
* CDO (console only)
* [CSZO](http://crawl.s-z.org)
* [CBRO](http://crawl.berotato.org)
* [CLAN](http://crawl.lantea.net:8080)
* [CPO](https://crawl.project357.org)
* [CXC](http://crawl.XTAHUA.com)

**Time Frame**

The competition will start TBA and will end 16 days later (two weeks including weekends on both ends). Any games still in progress will be scored as if they
died of old age at that point. The start and end times will be posted in
`??dieselrobin`

## Teams

### Composition

Teams are made up of 3 players. Players are allowed to form their
own teams or join up solo and get assigned to a team randomly, 
add your name to `??teamless` in this case (use `!learn edit teamless[1] s/$/, <name>/` to append your name to the list). 
Team rosters are frozen after the start of the competition. 

### Substitutions

If a player disappears for 48 hours when it is their turn to play a character or
otherwise gives notice of being unable to take their turn, the rest of their
team may ask anyone not already on a team to take that turn for them.

### Naming

Each team should choose a team name and three account names. Account
names **must** be in ALLCAPS. Each team also needs to pick an order of play and
decide which player will start which character (once combos are assigned).

Once you have a team name, all players must sign up in [##dieselrobin](https://webchat.freenode.net/?channels=##dieselrobin) with (use quotes if your team name has spaces):

	$signup <team>
	$signup "DON'T LABEL ME"

When the combos have been assigned, each player must assign the combo they want to start on to an allcaps account with:

	$assign <combo> <account>
	$assign DEMo DEEPELFMONK

### Combo Selection

Each player will choose one race/class combination. Players are
encouraged to choose combos which allow for a reasonable amount of flexibility.
Combos  which force a certain playstyle or set of circumstances are interesting
to play solo, but can be frustrating (or boring, in the case of overpowered
combos) in an ad-hoc team environment. Combos of the latter nature may be
replaced at the discretion of the organizers.

Once you have signed up to a team you can nominate a combo in [##dieselrobin](https://webchat.freenode.net/?channels=##dieselrobin) with:

	$nominate <combo>
	$nominate DgWn

### Organization

The bot in [##dieselrobin](https://webchat.freenode.net/?channels=##dieselrobin), **Kramell**, will track your progress and tell you when you have 
completed missions, what missions are available next, and which player is to play 
on that account next.

If you wish to keep track independently you could use an online spreadsheet 
similar to those used in previous competitions: [scoring sheet template](https://docs.google.com/spreadsheet/ccc?key=0AsDUl9FTpJmLdEh2ZnYtUlp3a3BESWJlUERqYklCdUE)

## For Players

### Turns

When it is your turn to play a character, you must complete exactly one
"mission" and then pass the character to the next player. Bonus missions can be
completed in tandem with a standard mission. The first few missions are fixed,
but later on you will usually have a choice of a few missions that can be done
in any order. You can backtrack to areas of earlier missions at any time, but
you may not enter new locations until you are starting the corresponding
mission. If you find yourself shafted past the current allowed levels in D or V,
you must ascend back to permitted levels as quickly as possible. See the
"Missions" section for a list of all the missions.

### Death or Victory

You get twenty tries to complete the first mission successfully. After the
twentieth try and in all later missions, deaths are permanent and mean the end
of the character. The other way a character can finish is by winning, which you
may attempt to do at any time after obtaining 3 runes. If a character has
completed every mission, the next player must attempt to win.


## Missions:

### Regular Missions

Each mission consists of a task or tasks that must be completed before
the character can be passed to the next player along with a list of locations
that become available for exploration once the mission is started. You may not
begin one mission and then decide that it is too hard and do another mission
instead; once begun, the only options are completion, death, or going to Zot and
winning instead. You do not have to stop immediately when you have completed the
tasks in the mission; they are just the minimum you have to do.

These missions can be queried in [##dieselrobin](https://webchat.freenode.net/?channels=##dieselrobin) with `$mission <num>` and are [listed online](./missions) for easy reference.


### Bonus Missions

There are 3 tiers of bonus missions: Tier 1 (2 points each), Tier 2 (4 points
each), and Tier 3 (6 points each)

The missions themselves will be kept secret until the start of the tournament.
Your team will assign one mission from each tier to each character before
starting a mission on any character.

Once you have started a mission, the bonus mission assignments are frozen.
The bonus mission assignments will be placed on the scoring sheet for your team.

If you are unable to assign all your missions due to character/class/race
makeup, we will swap a conflicting mission with an alternate mission for that
tier that can be completed.


## Scoring

### Regular Missions

Each completed mission is worth one point. Mission 1 must be completed without
dying to earn the point. Winning a character is worth 3 points. Thus the maximum
possible regular mission score for each character is 17 points. 

### Bonus Missions

Each completed bonus mission is worth the number of points assigned to it.

### Total Score

The character who scores the lowest on the regular mission will have their
regular mission score dropped. Any bonus missions completed by this character
are still worth points. 

(TBD, might change it a bit, simplify maybe)
3\*highest regular score + min(2\*2nd highest regular score, 21) + Tier 1 completed\*2 + Tier 2 completed\*4 + Tier 3 completed\*6
 
Max score: 51 + 21 + 6 + 12 + 18 = 108

### Ties

In the event that two or more teams have the same final mission score, each team
will create a new account and start a MuCK. You may not abandon Xom at any point
during a tiebreaker, and once you die, it's game over dude. No restarts on
Mission 1.  The starting player can be any player on your team, but the original
play order must be maintained after Mission 1. Once all teams have died or won,
the team with the highest score will win.